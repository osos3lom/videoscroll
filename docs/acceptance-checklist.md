# Real-device acceptance checklist

Automated tests run in desktop Chrome. This list covers what they can't:
real phones, cellular networks, and the installed app. Run it before inviting
people, and again after any change to playback, uploads or sign-in.

Devices: **iPhone Safari**, **iPhone home-screen app**, **Android Chrome**,
**desktop**. You need a second phone number for the test member. Delete that
account afterwards.

Use `✅` / `❌` and a note per device.

| # | Check | iPhone Safari | iPhone app | Android | Desktop |
| --- | --- | --- | --- | --- | --- |
| 1 | The login page is Arabic, right-to-left, and nothing overflows sideways | | | | |
| 2 | The owner signs in; the app is still signed in after a force-quit and reopen | | | | |
| 3 | The first video starts in about 2 s on 4G | | | | |
| 4 | Swiping to the next video starts almost instantly | | | | |
| 5 | Swiping back and seeking both work; sound toggles | | | | |
| 6 | Rotating the phone doesn't break the layout | | | | |
| 7 | **Profile → All videos** shows every video; rename works | | | | |

## Accounts (owner on one device, member on another)

| # | Check | Result |
| --- | --- | --- |
| 8 | **Add a member** with `05…`, viewer access, **Generate**, **Create account**; the copied message is complete | |
| 9 | The member signs in typing the number differently (`+966 5…`) and is sent to **Choose your password** | |
| 10 | Until they choose, opening `/profile` directly still shows only that page | |
| 11 | After choosing, the feed plays and there is **no +** button | |
| 12 | Owner presses **Reset password**: the member's next action goes to sign-in; the new temporary password works and forces a change again | |
| 13 | Owner changes the member to uploader: the member signs in again and now sees **+** | |
| 14 | Owner presses **Disable**: the member is sent to sign-in and can't sign back in | |
| 15 | Owner **Delete**s the test member; their videos stay | |

## Uploads (on cellular)

| # | Check | Result |
| --- | --- | --- |
| 16 | Upload a ~200 MB phone video; the progress bar moves steadily | |
| 17 | Turn airplane mode on mid-upload, then off, and pick the same file: it **resumes**, not restarts | |
| 18 | "Processing" then the success message; the video plays in the feed at full quality | |
| 19 | Delete it from **Profile**; it disappears from the feed | |

## Privacy and failure

| # | Check | Result |
| --- | --- | --- |
| 20 | **Sign out**: desktop DevTools → Application → IndexedDB `videoscroll-media` is empty | |
| 21 | Copy a video URL, sign out, open the URL: it fails once the media token expires or the account is disabled | |
| 22 | On the PC, `sudo systemctl stop videoscroll`: the app shows the can't-reach-server message. Start it again: the app recovers without signing in again | |

## Capacity

With 3–5 people watching at the same time from **outside** your network, run
`nload` (or `iftop`) on the PC.

| Check | Result |
| --- | --- |
| Peak upload in use (Mbps) vs. your line's upload speed | |
| Anyone stalled or buffering? | |

Keep peak use under about 80% of the line. The number of people who watched
comfortably is your limit for how many watch at once. Invite with that in
mind.
