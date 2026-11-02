# Work Diary Checker

A compliance checker for heavy vehicle drivers' work diaries. It is laid out like three daily
sheets from the National Driver Work Diary: yesterday, today and tomorrow. Drag along the WORK row
to mark work in 15-minute blocks and along the REST row to change it back to rest. Any breach of
the fatigue rules shows in red with its risk category.

**Use it:** <https://inobscurity.github.io/WorkDiaryChecker/>

**Your next limits** shows, from the time now, when you'll have to stop if you keep working
without a break: the next 15-minute break, the 12-hour daily limit, the latest time your 7-hour
rest can start, and so on, with a countdown for each. Use **Plan from** to pick another
day and time to plan a shift ahead, and **Time now** to go back to the current time. **Tap a red BREACH bar** (or any breach in
a list) to see which rule was broken, the exact period it covers shaded on the sheets, and its
risk category.

**Work before these sheets** takes optional totals for the days before the first sheet (5 days
for the 7-day limit, 12 for 14 days, 26 for 28 days, with the dates shown), plus long/night work
for BFM's 36-hour limit. With the first two sheets, ending with the middle sheet, they check the
longer work limits, and Your next limits takes them into account.

**Rest before these sheets** asks when your last 24-hour rest ended, and how many night rest
breaks and 24-hour rests you took in the days before, so the 7, 14 and 28-day rest rules can be
checked too. **Show the day before** adds an optional sheet for the day before the first one, for
when work ran overnight into it: every rule is then checked across that midnight.

It runs in any modern browser, on a phone, tablet or computer. Entries stay on the device; nothing
is sent anywhere.

## Install it as an app

Once installed, it opens full screen from its own icon and works with no signal.

- **iPhone or iPad (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **Computer (Chrome or Edge):** open the link and click the install icon at the right of the address bar.

## Work options checked

- Standard Hours: solo driver, solo bus driver, and two-up driver
- Basic Fatigue Management (BFM): solo and two-up driver

Standard hours and all risk categories come from the Heavy Vehicle (Fatigue Management) National
Regulation, current as at 1 August 2026 (Schedules 1 and 2). BFM hours come from the NHVR's
"Work and rest hours" page for operators whose BFM accreditation is still in force. AFM hours and
Alternative Compliance Hours (ACH) are set on each operator's certificate and are not checked.

Time is counted as on the NHVR "Counting time" page: periods under 24 hours from the end of any
rest break; longer periods from the end of the major rest break that period requires (7 hours for
24 hours, 24 hours for 7 days, a night rest break for 14 days, and so on), or from the end of any
rest break if it hasn't been taken. A later major rest break inside a 24-hour period does not
reset it, so the tests include the NHVR's worked example (12 hours by 7:45pm means no work until
6:00am).

All limits are in `RULESETS` in `rules.js`.

This is a guide only. Always check the current requirements with the National Heavy Vehicle
Regulator (NHVR).

## Hosting it yourself

The app is plain static files with no build step: `index.html`, `styles.css`, `rules.js`,
`app.js`, `sw.js`, `manifest.webmanifest` and the `icons` folder. Put them on any web host, such
as Netlify Drop, your own website or GitHub Pages. Offline use and installing need the site to be
served over HTTPS.

After changing any file, update `CACHE` in `sw.js` (for example `work-diary-checker-v2`) so
installed copies pick up the new version.

## Tests

```sh
node test/rules.test.js   # worked examples, including the NHVR's
node test/grid.test.js    # every limit at exactly the limit and 15 minutes past it
```
