# Play Console: everything to paste

Work top to bottom once the account is verified. Each heading matches a page in Play Console.

Files in this folder:

| File | Where it goes |
| --- | --- |
| `graphics/icon-512.png` | Store listing → App icon |
| `graphics/feature-graphic.png` | Store listing → Feature graphic (1024x500) |
| `graphics/screenshots/01..08` | Store listing → Phone screenshots, in this order |
| `../release/sharps-and-flats-1.0.0.aab` | Closed testing → Create release → App bundles |

---

## 1. Create app

Home → Create app.

| Field | Answer |
| --- | --- |
| App name | `Sharps&Flats` |
| Default language | English (United States) – en-US |
| App or game | App |
| Free or paid | Free (this can't be changed to paid later) |
| Declarations | Tick both (Developer Program Policies, US export laws) |

---

## 2. Store listing

Grow users → Store presence → Main store listing.

**App name** (30 max)

```
Sharps&Flats
```

**Short description** (80 max, this one is 77)

```
Learn the songs you love on guitar or ukulele. Chords, tuner, rhythm and ear.
```

**Full description** (4000 max)

```
Sharps&Flats helps you learn real songs on guitar or ukulele, and keeps track of how each one is going.

Add a song you want to play, with its chords, strumming and the words. Practise it a little every day. The app shows what to work on next, which chords still feel shaky, and how far you have come.

SONGS
• Keep every song you are learning in one place, with its key, capo, chords and strumming
• Write out the words with the chord changes above them, then play along at your own tempo
• Mark each song as learning, playable, solid or complete
• Log what you practised and what to fix next time

CHORDS
• See every chord your songs need, with a diagram for each
• Rate how each one feels, and the shaky ones come up first
• Drill the changes between two chords until they are smooth

TUNER
• A tuner that listens through the microphone
• Standard and alternate tunings for guitar and ukulele
• A voice mode that finds your singing range

RHYTHM AND EAR
• A metronome with a visual beat, accents and swing
• Ear training for intervals and chords
• Play challenges where the app listens and checks your notes

THEORY YOU CAN HEAR
• Scales, keys and the chords that belong together, played out loud
• A short journey of fifteen steps for complete beginners
• Sound physics: why notes sound the way they do

PRIVATE BY DESIGN
• No account, no ads, no tracking
• Your songs and progress stay on your phone
• The microphone is only used live to hear your notes. Nothing is recorded or sent anywhere.
• Works offline

Back up your library to a file at any time, and restore it on a new phone.
```

**Graphics**

- App icon: `graphics/icon-512.png`
- Feature graphic: `graphics/feature-graphic.png`
- Phone screenshots: all eight in `graphics/screenshots/`, in number order
- Tablet screenshots: skip (optional)

Songs in the screenshots: Hotel California, Wonderwall, Hey There Delilah, Canon in D, Cavatina, Asturias, Wish You Were Here. Canon in D and Asturias are public domain; the rest are copyrighted, so the screenshots show only each song's title, artist and chords. Rules for any future screenshots:

- Never show lyrics of a copyrighted song.
- No album art, band photos or logos.
- No wording that suggests a licence or endorsement (for example "Official", "Learn Oasis songs"), and no artist names in the app title or descriptions.

**Category and contact** (Store settings page)

| Field | Answer |
| --- | --- |
| App category | Music & Audio |
| Tags | Music education, Guitar, Tuner (pick what Play offers) |
| Email | Your developer contact email (shown publicly) |
| Website | `https://blues1998.github.io/sharps-and-flats/` |
| Phone | Leave empty |

---

## 3. App content

Policy and programs → App content. Answer every card.

**Privacy policy**

```
https://blues1998.github.io/sharps-and-flats/privacy.html
```

**Ads:** No, my app does not contain ads.

**App access:** All functionality is available without special access.

**Content rating** (IARC questionnaire)

| Question | Answer |
| --- | --- |
| Email | Your developer email |
| Category | All other app types |
| Violence, fear, sexuality, language, drugs, gambling | No to all |
| Users can interact or exchange content | No |
| Shares user's current physical location | No |
| Allows purchase of digital goods | No |
| Unrestricted internet access (web browser) | No |

Expected result: Everyone / PEGI 3 / IARC 3+.

**Target audience and content**

| Question | Answer |
| --- | --- |
| Target age groups | 13–15, 16–17, 18 and over |
| Could the app unintentionally appeal to children? | No |

Don't tick any group under 13: that brings in the Families policy and extra review, and the privacy policy says the app isn't aimed at under-13s.

**Data safety**

The Android app sends anonymous usage events (PostHog) and crash reports (Sentry), on by default, with a switch in Me. That counts as collecting data, so the answers are:

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (both services only take HTTPS) |
| Do you provide a way for users to request that their data be deleted? | **No** (nothing is tied to a person or an account; both services delete it on their own schedule) |

Then tick these data types, and nothing else:

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| App activity › App interactions | Yes | No | Yes, users can turn it off | Analytics |
| App info and performance › Crash logs | Yes | No | Yes | Analytics |
| App info and performance › Diagnostics | Yes | No | Yes | Analytics |
| Device or other IDs | Yes | No | Yes | Analytics |

Leave "Processed ephemerally" off for all four.

Why these answers:

- **Shared: No.** Sentry and PostHog handle the data on our behalf, and Play doesn't count sending data to a service provider that processes it for you as sharing.
- **Device or other IDs.** PostHog's random install ID counts as an ID even though it isn't the Android advertising ID.
- **Not listed.** Microphone audio is processed live on the phone and never sent, so it isn't collected. Songs, names and emails never leave the phone.
- **The website.** Sign-in and cloud backup only exist on the website, and the website sends no usage or crash reports.

Before answering, make sure "Discard client IP data" is on in PostHog's project settings and "Prevent storing of IP addresses" is on in Sentry's project settings: the privacy policy says neither stores IP addresses.

**Remaining declarations**

| Card | Answer |
| --- | --- |
| News app | No |
| COVID-19 contact tracing | My app is not a contact tracing or status app |
| Government app | No |
| Financial features | My app doesn't provide any financial features |
| Health | My app doesn't have health features |
| Advertising ID | No (the app doesn't use it) |
| Photo and video permissions | Not asked (the app doesn't request them) |

---

## 4. Closed testing (required before production)

Personal accounts need **12 testers opted in for 14 days in a row** before you can apply for production.

1. Test and release → Testing → Closed testing → Create track (or use "Alpha").
2. Testers tab → Create email list → paste the Gmail addresses (one per line).
3. Countries: add India, plus any country where your testers live.
4. Create release → upload `release/sharps-and-flats-1.0.0.aab`.
   - Play App Signing: accept the default (Google keeps the app signing key, you keep the upload key).
5. Release name: `1.0.0`. Release notes:

```
<en-US>
First release. Add your songs, rate your chords, tune up and practise every day.
</en-US>
```

6. Save → Review release → Start rollout to Closed testing.
7. Copy the **opt-in link** from the Testers tab and send it to everyone.

Testers must open the link, tap "Become a tester", then install from the Play Store. Being on the email list isn't enough; Play only counts people who opted in. Get a few more than 12 in case some drop out.

**Message for testers** (copy and send)

```
Hi! I've made a guitar and ukulele practice app and need testers before it can go on the Play Store.

1. Open this link on your Android phone, signed in with the Gmail I have for you: <OPT-IN LINK>
2. Tap "Become a tester"
3. Install Sharps&Flats from the Play Store link on that page
4. Please keep it installed for at least 14 days, and open it now and then

Any feedback is welcome. Thanks!
```

---

## 5. Production (after the 14 days)

1. Dashboard → Apply for production. Google asks a few questions about the test: who tested, what feedback you got and what you changed. Answer in plain sentences.
2. Approval usually takes up to 7 days.
3. Then Production → Create release → promote the tested release (or upload a new `.aab`).

**Before every new upload**: raise `versionCode` in `android/app/build.gradle` (currently 1), then run `npm run release:android`.

---

## Things only you can do

- [ ] Back up `~/.android-keys/sharpsandflats-upload.jks` and the password in `android/keystore.properties` (in a password manager, plus one offline copy). If you lose them you can ask Google to reset the upload key, but it takes days.
- [ ] Collect at least 12 Gmail addresses for testers (aim for 15).
- [ ] Decide the public contact email for the listing.
