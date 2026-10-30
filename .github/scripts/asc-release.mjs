// Hazırlanan App Store sürümü için: ekran görüntüleri, derleme, incelemeye gönderme. Sırları yazdırmaz.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY_P8, ASC_APP, SHOTS = '', BUILD = '', SUBMIT = 'false' } = process.env;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = () => {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: ASC_API_KEY_P8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
};

const api = async (method, url, body) => {
  const response = await fetch(url.startsWith('http') ? url : `https://api.appstoreconnect.apple.com${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ASC ${method} ${url} -> ${response.status} ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : {};
};

const versions = await api('GET', `/v1/apps/${ASC_APP}/appStoreVersions?filter[platform]=IOS&limit=5`);
const version = versions.data.find((item) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(item.attributes.appStoreState));
if (!version) throw new Error(`Hazırlanan sürüm yok: ${versions.data.map((item) => `${item.attributes.versionString}:${item.attributes.appStoreState}`).join(', ')}`);
console.log(`Sürüm ${version.attributes.versionString} (${version.attributes.appStoreState})`);

const SETS = [
  { folder: 'iphone-light', displayType: 'APP_IPHONE_67' },
  { folder: 'ipad-light', displayType: 'APP_IPAD_PRO_3GEN_129' },
];

const findShot = (folder, name) => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  return walk(path.join('shots', folder)).find((file) => path.basename(file) === `${name}.png`);
};

const uploadShot = async (setId, file) => {
  const bytes = fs.readFileSync(file);
  const reserved = await api('POST', '/v1/appScreenshots', { data: {
    type: 'appScreenshots',
    attributes: { fileName: path.basename(file), fileSize: bytes.length },
    relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
  } });
  for (const part of reserved.data.attributes.uploadOperations) {
    const chunk = bytes.subarray(part.offset, part.offset + part.length);
    const headers = Object.fromEntries(part.requestHeaders.map((header) => [header.name, header.value]));
    const put = await fetch(part.url, { method: part.method, headers, body: chunk });
    if (!put.ok) throw new Error(`Yükleme ${put.status}`);
  }
  await api('PATCH', `/v1/appScreenshots/${reserved.data.id}`, { data: {
    type: 'appScreenshots',
    id: reserved.data.id,
    attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(bytes).digest('hex') },
  } });
};

const names = SHOTS.split(',').map((name) => name.trim()).filter(Boolean);
if (names.length) {
  const localizations = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  for (const localization of localizations.data) {
    const existing = await api('GET', `/v1/appStoreVersionLocalizations/${localization.id}/appScreenshotSets?limit=50`);
    for (const { folder, displayType } of SETS) {
      let set = existing.data.find((item) => item.attributes.screenshotDisplayType === displayType);
      if (!set) {
        set = (await api('POST', '/v1/appScreenshotSets', { data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: displayType },
          relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localization.id } } },
        } })).data;
      }
      const old = await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
      for (const item of old.data) await api('DELETE', `/v1/appScreenshots/${item.id}`);
      for (const name of names) {
        const file = findShot(folder, name);
        if (!file) throw new Error(`Ekran görüntüsü yok: ${folder}/${name}`);
        await uploadShot(set.id, file);
      }
      console.log(`${localization.attributes.locale} ${displayType}: ${names.length} görüntü yüklendi`);
    }
  }
}

if (BUILD) {
  const builds = await api('GET', `/v1/builds?filter[app]=${ASC_APP}&filter[version]=${BUILD}&limit=5`);
  const build = builds.data[0];
  if (!build) throw new Error(`Build yok: ${BUILD}`);
  console.log(`Build ${BUILD}: ${build.attributes.processingState}`);
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
  console.log('Build sürüme bağlandı');
}

if (SUBMIT === 'true') {
  const submission = await api('POST', '/v1/reviewSubmissions', { data: {
    type: 'reviewSubmissions',
    attributes: { platform: 'IOS' },
    relationships: { app: { data: { type: 'apps', id: ASC_APP } } },
  } });
  await api('POST', '/v1/reviewSubmissionItems', { data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.data.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
    },
  } });
  const sent = await api('PATCH', `/v1/reviewSubmissions/${submission.data.id}`, { data: {
    type: 'reviewSubmissions', id: submission.data.id, attributes: { submitted: true },
  } });
  console.log(`İncelemeye gönderildi: ${sent.data.attributes.state}`);
}
