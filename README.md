# mobil-ios-build

İlkay'ın Expo uygulamalarını GitHub'ın ücretsiz Mac makinesinde derleyip TestFlight'a gönderen
ortak iş akışı. Uygulamaların kaynakları kendi gizli depolarında kalır; burada kod ya da sır yoktur.
İş yalnız elle tetiklenir; oluşan IPA herkese açık yüklenmez, doğrudan App Store Connect'e gider.

```bash
gh workflow run ios.yml -R ilkayturna/mobil-ios-build -f app=trader-mobile
```
