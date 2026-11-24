# Releasing the mobile apps

The Android and iOS apps are released separately from the server. Server releases are tagged
`v<version>` and build the Docker image (`docker.yml`); mobile releases are tagged
`mobile-v<version>` and run `.github/workflows/mobile-release.yml`. The two version numbers are
independent, and `docker.yml` ignores releases whose tag starts with `mobile-v`.

## Release steps

1. Merge everything to `main` and wait for the `mobile-android-gate` and `mobile-ios-gate` checks.
2. Push the tag. The version is `x.y` or `x.y.z`:

   ```bash
   git tag mobile-v1.2.0
   git push origin mobile-v1.2.0
   ```

3. The workflow `Mobile Release` starts. Its `prepare` job creates the GitHub release
   `mobile-v1.2.0` (marked not-latest, so the server release stays the repository's latest one) if
   it does not exist yet, then:
   - **Android** builds a signed AAB and a signed universal APK, keeps both as workflow artifacts,
     attaches the APK as `hauswart-1.2.0.apk` to the GitHub release (for self-hosters who sideload)
     and uploads the AAB to the Google Play internal testing track.
   - **iOS** builds, signs and uploads the app to TestFlight; the IPA is kept as workflow artifact.
4. Promote the build in Google Play Console (internal testing to production) and in App Store
   Connect (TestFlight to App Store review) by hand.

**Versions.** The version without the prefix is the Android `versionName` and the iOS
`MARKETING_VERSION` (Gradle properties `APP_VERSION`, `BUILD_NUMBER`). The workflow run number is
the iOS build number and is folded into the Android `versionCode`, so a re-run always increases
it.

**Retrying one platform.** Re-running failed jobs uses the workflow file from the tag. To retry with
a fix from `main`, start `Mobile Release` from the Actions tab with the input `version` (`1.2.0`)
and `platforms` (`android` or `ios`, default `both`). The tag must already exist; the workflow
builds the branch it was started from.

**Missing secrets never fail the run.** Each store step is skipped with a notice in the run summary
when its secrets are not set:

- without the four `ANDROID_*` signing secrets the Android build is unsigned and only kept as an
  artifact (no release attachment, no Play upload),
- without `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` only the Play upload is skipped,
- without all seven iOS secrets the iOS job is skipped.

## Secrets

All of them are repository secrets (Settings, Secrets and variables, Actions). The workflows read
no repository variables; `GITHUB_TOKEN` is the built-in one.

| Name                               | Used for               | What it is and how to create it                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`          | Android signing        | The upload keystore, base64 on one line. Create it once with `keytool -genkeypair -v -keystore upload.jks -alias hauswart -keyalg RSA -keysize 2048 -validity 10000`, then `base64 -w0 upload.jks \| gh secret set ANDROID_KEYSTORE_BASE64`. Keep the file and its passwords somewhere safe: the key signs every APK and is the upload key Play checks. Never commit it (`*.jks` is ignored). |
| `ANDROID_KEYSTORE_PASSWORD`        | Android signing        | The keystore password chosen in `keytool`.                                                                                                                                                                                                                                                                                                                                                    |
| `ANDROID_KEY_ALIAS`                | Android signing        | The key alias (`hauswart` in the command above).                                                                                                                                                                                                                                                                                                                                              |
| `ANDROID_KEY_PASSWORD`             | Android signing        | The password of that key (the same as the keystore password for a PKCS12 keystore).                                                                                                                                                                                                                                                                                                           |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play upload     | Optional. The JSON key of a service account, pasted as plain text. In Google Cloud create a project, enable the Google Play Android Developer API, create a service account and a JSON key; in Play Console, Users and permissions, invite the service account's email address and grant it release permissions for the app.                                                                  |
| `APP_STORE_CONNECT_API_KEY_BASE64` | iOS signing and upload | The `.p8` App Store Connect API key, base64 on one line. App Store Connect, Users and Access, Integrations, App Store Connect API, generate a key with the role Admin or App Manager (the `.p8` can be downloaded only once), then `openssl base64 -A -in AuthKey_XXXXXXXXXX.p8 \| gh secret set APP_STORE_CONNECT_API_KEY_BASE64`.                                                           |
| `APP_STORE_CONNECT_KEY_ID`         | iOS signing and upload | The Key ID shown next to that API key.                                                                                                                                                                                                                                                                                                                                                        |
| `APP_STORE_CONNECT_ISSUER_ID`      | iOS signing and upload | The Issuer ID shown above the API key list.                                                                                                                                                                                                                                                                                                                                                   |
| `APPLE_TEAM_ID`                    | iOS signing            | The 10-character team ID (developer.apple.com, Membership details). The job injects it into `iosApp/ExportOptions.plist`, which does not store it.                                                                                                                                                                                                                                            |
| `IOS_DIST_CERT_P12_BASE64`         | iOS export signing     | An Apple Distribution certificate with its private key as `.p12`, base64 on one line. Create a certificate signing request in Keychain Access, create an "Apple Distribution" certificate in the developer portal with it, install it, export it from Keychain Access as `.p12`, then `openssl base64 -A -in dist.p12 \| gh secret set IOS_DIST_CERT_P12_BASE64`.                             |
| `IOS_DIST_CERT_PASSWORD`           | iOS export signing     | The password chosen when exporting the `.p12`.                                                                                                                                                                                                                                                                                                                                                |
| `IOS_PROFILE_APP_BASE64`           | iOS export signing     | The App Store provisioning profile for `ch.orellbuehler.hauswart`, with the exact name `Hauswart App Store` (the name `iosApp/ExportOptions.plist` refers to), created with the Apple Distribution certificate above. Download it, then `openssl base64 -A -in Hauswart_App_Store.mobileprovision \| gh secret set IOS_PROFILE_APP_BASE64`.                                                   |

The iOS job compares the stored profile with the export options and the app's entitlements file
(`iosApp/Hauswart/Hauswart.entitlements`, if the app has one) before it builds, and stops within a
minute with a clear message when the profile is expired, misnamed, for another app or lacks an
entitlement. When the app gains a capability, enable it on the App ID, regenerate the profile and
update `IOS_PROFILE_APP_BASE64`. Cloud signing during the archive step creates throwaway
development certificates; the job revokes them afterwards with
`mobile/scripts/ios/revoke-ci-certs.mjs`. Run that script by hand (without `--apply` it only
lists) if an archive ever fails with "maximum number of certificates".

## One-time setup

### Google Play Console

1. Create the app with the package name `ch.orellbuehler.hauswart` and complete the store listing,
   content rating, data safety and app access declarations that Play requires before any release.
2. Keep Play App Signing enabled (the default). The keystore above is the upload key.
3. **Upload the first build by hand.** The Play API cannot create the app's first release, and a
   brand-new app can refuse a release with status `completed`. Download the signed `release-aab`
   artifact of a workflow run (a dispatch with `platforms` = `android` works without a store
   account) and upload it in Play Console as a release on the internal testing track, adding the
   testers. From then on the workflow uploads to that track.
4. Set up the service account described in the secrets table and invite it to the app.

### Apple Developer and App Store Connect

1. In the developer portal register the App ID `ch.orellbuehler.hauswart` (explicit) with the
   capabilities the app needs.
2. In App Store Connect create the app record (New App, platform iOS) with that bundle ID and a
   name and SKU of your choice.
3. Create the Apple Distribution certificate and the App Store profile `Hauswart App Store` as
   described in the secrets table, and the App Store Connect API key.
4. Set the secrets. Push a `mobile-v*` tag: the first TestFlight upload appears under TestFlight in
   App Store Connect after processing (usually within half an hour). Add internal testers there;
   they get the build through the TestFlight app. If App Store Connect asks about export
   compliance for a build, answer it once, or declare it in the app's Info.plist.
