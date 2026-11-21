# Incident Compass

A local cloud incident desk for the Brampton AI Innovator challenge. It includes 30 fictional services, 10 archived incidents and four alert scenarios.

## Open the dashboard

On Windows, double-click `Start Incident Compass.cmd` after installing Node.js 22 or newer. Or run the following from this directory. There are no project dependencies to install.

```powershell
node --env-file-if-exists=.env server.mjs
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in Chrome or Edge.

You can also run `npm start` from the project directory. For a browser-only preview, open [demo/incident-compass.html](demo/incident-compass.html) locally. Run `npm run check` to check the source syntax.

## Enable Gemini

Use [Google AI Studio](https://aistudio.google.com/apikey) to create a Gemini API key in your own free-tier project. Copy `.env.example` to `.env`, enter the key privately, and restart the server. The API key stays on the local server. When the key or API is unavailable, the assistant uses labeled, record-based demo answers.

The microphone uses browser dictation where available, subject to the browser's microphone permission and speech service. The assistant also accepts typed questions and can read a response aloud.

## Demo path

1. **After a release** shows the checkout failure and the recent Payments API release. Open **Investigation log** for the actual record lookups and **Time Machine** to move between the alert at 10:02 and the provider bulletin at 10:07. The bulletin's availability time differs from the provider's estimated outage start.
2. On the urgent checkout case, **Page on-call** starts a 30-second acceptance window for Maya Chen. Try **Accept task**, or use **I’m busy** or **Simulate timeout** to create a team-wide message in **# General**. Switch to another teammate and claim it. Use **Reset** in the alert queue to run the other branch.
3. **Repeat incident** finds a matching signature and shows its previous responder and documented fix. **Unknown issue** shows the recent changes and says no fix is known. **Planned work** adds a maintenance scenario.
4. Try **Ask assistant**, **Draft handoff**, or **3 a.m. mode**. Use the **Services**, **History** and **Calendar** views to browse the same fictional environment.
5. **Notifications** records simulated alerts, pages, escalations and claims. **Change priority** lets the engineer override the suggested severity. The checkout brief groups two sample alerts and includes a duration slider for orders at risk. Handoff drafts can be edited and saved on this browser. Gemini can interpret follow-up questions within the current incident and replay snapshot.
6. Open **Case details** to inspect incident facts, linked findings, known unknowns, and the raw records available at the selected replay time. The **Runbooks** tab shows the applicable procedure or investigation guide. The main **Runbooks** navigation opens the searchable sample library. Runbooks include prerequisites, steps, when to pause, and verification criteria. A procedure from a different error signature is reference material only.

Escalations and ownership are shared between tabs in the same browser profile. The timer runs while a dashboard tab is open and catches up after reopening. The demo uses a simulated channel and makes no changes to services.

## External alert delivery

Open **Alerts → Delivery setup** to configure SMS with Twilio, email with Resend, or Telegram with a bot. Saving settings makes no external requests. The forms save credentials in an ignored, server-only local file. Environment variables from `.env.example` can also be used and take precedence. A Resend sender needs a verified domain. A Telegram bot must have access to the target chat or permission to post in the channel.

To pair your private Telegram chat, paste the token directly in **Configure Telegram** and choose **Pair and save my chat**. Open the supplied bot link and tap **Start**. The app detects the matching one-time command, checks that the bot can access the chat, and saves the connection automatically. Pairing does not send a Telegram alert.

### Telegram on-call routing

Under **Alerts → Telegram routing**, pair a team group and optionally add private responders. The bot must be allowed to post in the group. Share a responder pairing link only with the intended responder. To start a route, pick an alert, click **Route in Telegram**, review its destinations and messages, then confirm.

If the Telegram invite link does not complete pairing, add the bot in Telegram first. Then use **Pair team group → Bot already added? Verify by group ID** to check and save the group directly.

- **P1 Critical:** Post directly in the group. The first team member to tap **Claim incident** becomes the recorded responder.
- **P2 High / P3 Monitor:** Page the selected private responder. They can tap **Accept** or **Decline**. A reply directly to the page acknowledges it unless it begins with a decline such as “busy,” “no,” or “decline.” Declines and expired response windows post to the group.

The local server polls Telegram for replies while a route is active and saves routes outside the source bundle. Keep the server running for timely escalation. After a restart it resumes pending routes. If a group message might have been sent during the restart, it asks the operator to check Telegram before retrying. Use a dedicated bot without a webhook or another update poller.

**Automatic Telegram alerts** routes new demo alert events as soon as they are triggered from the Desk. Select a default private responder and timeout in **Alerts → Telegram routing**. Enabling the mode does not send the incidents that are already in the queue. The local alert-event endpoint can accept events from an integration in the same local app; the demo is not connected to a real monitoring service.

Create a **Shared responder link** in the same panel. Once a group member opens it and taps **Start**, the bot verifies their group membership and adds their private chat to the responder list. Team alerts include the link automatically. New teammates join the Telegram group first using a group invitation. Telegram requires each person to start the bot before it can send them a private message. If membership checks cannot see other group members, the group owner may need to make the bot an administrator.

Set the local recipient lists in `.alert-recipients.local.json` beside `server.mjs`, using the format `{"email":[],"sms":[]}`. Enter telephone numbers in international E.164 format. Telegram uses the chat ID or public channel username in its provider settings. The dashboard masks recipients on screen. The source bundle excludes the local recipient and credential files.

In **Alerts**, filter by severity or open any incident card. Use **Review delivery** to choose recipients and see the exact message, then **Confirm and send live** for configured providers. A preview with no recipients shows the three channel formats. Simulating an alert, setting a provider, or letting an in-app page expire does not automatically send external messages. Provider acceptance is recorded during the current server session and may precede final delivery. The standalone HTML uses in-app alerts; external delivery requires the local server.
