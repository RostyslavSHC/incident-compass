# A U R E L I S

**Intelligence. Awareness. Action.**

A local cloud incident desk for the Brampton AI Innovator challenge. It includes 30 fictional services, 10 archived incidents and four alert scenarios.

## Open the dashboard

On Windows, double-click `Start Incident Compass.cmd` after installing Node.js 22 or newer. Or run the following from this directory. There are no project dependencies to install.

```powershell
node --env-file-if-exists=.env server.mjs
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in Chrome or Edge.

Use `npm start` to launch the server, `npm run check` to check the source syntax, or `npm test` to run the tests. For a browser-only preview, open [demo/incident-compass.html](demo/incident-compass.html) locally.

## Run the live demo

Open **Incident simulator** from the workspace menu. Choose a template to edit it, use **Run now** for a single incident, or choose **Run all four severities** to demonstrate incoming alerts. To create your own event, fill in the form, preview the incident, and confirm. Schedule a trigger in the device’s local time. Incident timestamps in the workspace display Eastern Time.

Under **Challenge 4 alert feed**, send a repeat alert, a release-related alert, or an unfamiliar alert. Each one opens an automatic Desk brief and creates an in-app notification. These samples use the fictional November 20 monitoring timeline. For a custom alert, include its error code in the description. The Desk checks the sample archive for the same service and code, and checks sample changes in the two hours leading up to the incident timestamp.

On the Desk, acknowledge the incident, update its status and severity, and resolve it with a recovery note. The queue and active counts update, and resolved test incidents appear in History. Find upcoming events in the simulator or Calendar. Use **Notifications** for unread activity, notification history, and the sound toggle.

In **Resolve**, you can copy a matching previous fix or enter your own notes and choose **Format notes with Gemini**. Review the confirmed cause, applied fix and recovery verification before saving. New alerts with the same service and error signature can retrieve that reviewed fix from this browser workspace. **Runbooks** shows the last recorded verification and flags known version differences. **Compare** explains each archive match and **Family tree** opens related alerts, changes, fixes and procedures.

New test alerts with the same error code group when they occur within five minutes on the same service or a known dependency. The primary incident keeps the grouped source alerts, and a higher-severity alert records the reason for promotion.

Open **Reports** for weekly, monthly, and yearly activity in Eastern Time. The page shows openings, resolutions, average alert-to-fix time, and responder work time when the same person accepted and completed the task. Turn off **Include demo history** to see recorded workspace activity only. On the incident Brief, use the duration slider and editable assumptions to explore estimated financial exposure in CAD.

Filter Reports by company to see its incident volumes, repeat signatures, and resolution channels. The two donut charts visualize company openings and resolution channels. A repeat is the same company, service and error code on separate incidents in the selected period. Gemini analyzes the selected report automatically using aggregate counts and error codes. Enter the fictional company in the simulator when creating a custom alert. Older alerts without company metadata appear as **Unassigned**.

After accepting or claiming a routed Telegram task, the responder can tap **Mark fixed** to record their completion. The Desk syncs the timing. You can then add a reviewed resolution with **Resolve**, or save the website report first to close the accepted Telegram route. Telegram setup uses the existing bot and paired destinations.

The browser profile stores custom test events. Keep the workspace open to fire a scheduled test on time. An overdue test fires when the workspace next opens. When Telegram automation is enabled, custom incidents route as soon as they fire. Telegram labels them **TEST EVENT**. **Reset custom simulations** clears the local test events and their in-app notifications after confirmation.

Run `node --test test/simulations.test.mjs` to check severity templates, validation, scheduling, the status lifecycle, and automatic evidence matching.

## Enable Gemini

Use [Google AI Studio](https://aistudio.google.com/apikey) to create a Gemini API key in your own free-tier project. Copy `.env.example` to `.env`, enter the key privately, and restart the server. The API key stays on the local server. When the key or API is unavailable, the assistant uses labeled, record-based demo answers.

When an alert fires, the Desk shows the evidence-linked brief immediately and requests a Gemini analysis in the background. The AI analysis cites sample records, explains the main uncertainty, and suggests a first check. The browser saves the analysis for that incident. Use fictional descriptions in the simulator because the alert and its evidence are sent to Gemini. **Ask assistant** is available for follow-up questions and voice interaction.

The microphone uses browser dictation where available, subject to the browser's microphone permission and speech service. The assistant also accepts typed questions and can read a response aloud.

## Enable email alerts

Run `npm ci` to install Gmail SMTP support, then start the local server. Open **Alerts → Delivery setup → Configure Email** and choose **Gmail**. Use a personal Gmail sender with 2-Step Verification and generate a [Google app password](https://myaccount.google.com/apppasswords) for Aurelis. Enter the sending address and app password in the local form. Add or replace recipients with one address per line. Credentials and recipient addresses are saved in ignored local settings files.

Use **Check connection** to verify the sign-in and **Send test email** to send one demo message per saved recipient. Confirm inbox delivery, then select **Enable automatic email**. It sends an informational copy of each new incident or confirmed Telegram alert. Each recipient gets one copy per alert or route, including when a private page escalates. Accept, decline, and mark incidents fixed in Telegram. Changing email credentials or recipients turns automatic email off until enabled again. Resend remains available if you already have a verified sending domain.

To add someone from the dashboard, open the responder picker and select **Add team member**. Enter the member’s name and Outlook email address. Select a chat that is already paired or copy a one-time link for the member to open and tap **Start** in Telegram. Aurelis shows both linked channels on one profile. Email goes to all saved recipients when automatic email is enabled. Private Telegram pages still go to the selected responder, and adding a private chat does not add its owner to the Telegram group.

Use **Manage people** in the responder menu to change an email address, resend its confirmation, or remove a recipient. Saving a new address sends a confirmation email to that address, including when automatic incident email is off. Removing a linked member stops email copies and future private pages for that profile. Unanswered Telegram pages go to the paired team group. Manage group membership in Telegram.

For a pending pairing, choose **Manage people → Telegram link** to reopen the saved invite. Choose **Regenerate link** to replace it. The invite is valid for 30 minutes. Aurelis can prepare the link while offline if it already knows the bot’s username. The member’s **Start** still needs a connection to reach Aurelis. When Gmail fails before submission, Aurelis queues the confirmation for retry for up to a day.

## Demo path

1. **After a release** shows the checkout failure and the recent Payments API release. Open **Investigation log** for the actual record lookups and **Time Machine** to move between the alert at 10:02 and the provider bulletin at 10:07. The bulletin's availability time differs from the provider's estimated outage start.
2. On the urgent checkout case, **Page on-call** starts a 30-second acceptance window for Maya Chen. Try **Accept task**, or use **I’m busy** or **Simulate timeout** to create a team-wide message in **# General**. Switch to another teammate and claim it. Use **Reset prepared alerts** in the alert queue to run the other branch.
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
- **Lower severities:** Page the selected private responder. They can tap **Accept** or **Decline** before the deadline shown in Telegram. A direct reply acknowledges the page unless it begins with a decline such as “busy,” “no,” or “decline.” Declines and expired response windows post to the group. **Track Telegram route** shows the live countdown and the latest outcome in the dashboard.

The local server polls Telegram for replies while a route is active and saves routes outside the source bundle. Keep the server running for timely escalation. After a restart it resumes pending routes. If a group message might have been sent during the restart, it asks the operator to check Telegram before retrying. Use a dedicated bot without a webhook or another update poller.

**Automatic Telegram alerts** routes new prepared alerts and custom incidents when they fire. Select a default private responder and timeout in **Alerts → Telegram routing**. Enabling the mode does not send incidents already in the queue. The local alert-event endpoint can accept events from an integration in the same local app; the demo is not connected to a real monitoring service.

Open **Alerts → Send Telegram notification** or **Notify in Telegram** on a custom incident. Choose the group for a one-time post, or choose an individual and select **Send and start timer**. A manual private page uses the configured response timeout, or 60 seconds if none is set. Declines and timeouts escalate to the paired group.

Create a **Shared responder link** in the same panel. Once a group member opens it and taps **Start**, the bot verifies their group membership and adds their private chat to the responder list. Team alerts include the link automatically. New teammates join the Telegram group first using a group invitation. Telegram requires each person to start the bot before it can send them a private message. If membership checks cannot see other group members, the group owner may need to make the bot an administrator.

Set the local recipient lists in `.alert-recipients.local.json` beside `server.mjs`, using the format `{"email":[],"sms":[]}`. Enter telephone numbers in international E.164 format. Telegram uses the chat ID or public channel username in its provider settings. The dashboard masks recipients on screen. The source bundle excludes the local recipient and credential files.

In **Alerts**, filter by severity or open any incident card. On a prepared incident, use **Review delivery** to choose recipients and see the exact message, then **Confirm and send live** for configured providers. A preview with no recipients shows the three channel formats. Prepared alerts can send automatically when Telegram automation is enabled. Provider acceptance is recorded during the current server session and may precede final delivery. The standalone HTML supports in-app alerts. Start the local server to use external providers.
