## What is new

**When a mailbox stops syncing**
- The notice about a mailbox that stopped syncing is shorter. The technical text is behind "Show details".
- When the fault is at the mail server (for example, Outlook itself is down), the notice says so, and it no longer offers Reconnect, which does not help then. If the fault lasts 30 minutes or more, the notice says since when the mailbox has had no new mail.
- A fault at the mail server shows one notice, not two. Before, a red message with the whole failed request for your contacts also showed. Contact sources in Settings now says it in plain words.

**Security**
- The libraries that Mail is built with have their newest security fixes.

**One conversation across two mailboxes**
- A conversation that you start in one mailbox and answer from another is now one conversation. Before, Mail showed two rows, each with half of it. The list shows one row, the conversation shows every message in order, and archive, delete and move take both halves.
- Mail joins the two halves when one answers a message of the other, and only when the subject is the same. A reply with a new subject is a conversation of its own.
- Inside one mailbox nothing changes: Mail shows the conversations as the mail server groups them.

**Fixes**
- A reply keeps one reply mark in its subject. Before, a reply to "RE: …" or "SV: …" went out as "Re: RE: …" or "Re: SV: …". On an Exchange mailbox, the answer to such a reply could then show as a conversation of its own.
- The "Move to folder" list stays inside the window. Before, opened from a mail low in the list, its top ran off the window, with the search box and Inbox out of sight.
- Gmail sends on port 587 when the network shuts port 465. Before, on such a network a message stayed in the outbox.
- A message that cannot be sent for 10 minutes says so: its row in Scheduled says "Not sent yet" with the reason, and a notice tells you once. Before, nothing showed.

**Rules for a sender**
- Right-click a mail and choose "Rules for …" to say where that sender's future mail goes: always to Junk, always to Archive, always to a folder, or always to Trash. One click makes the rule, and it also moves the mail of theirs that is in the inbox now.
- "More options…" opens the full rule: this sender only or everyone at their domain, the folder to use, and whether the mail already in the inbox goes too.
- A sender with a rule shows it as "In use". "Remove this rule" takes it away.
- Mail runs the rules after each sync. A rule does not run while Mail is closed: mail that came then is moved when you next open Mail.

**Quiet hours and paused mailboxes**
- Mail that comes in during a pause stays out of sight everywhere. Before, the Sent list could show a reply the pause was holding back: its time, its first words and bold text, though the conversation did not show it.
- A reply held back during a pause shows in the conversation when the pause ends. Before, it could stay missing.
- Mail held back during a pause is still unread when the pause ends. Before, it was marked read when you opened the conversation during the pause.
- During a pause, each folder shows its own mail. Before, after a look at Sent, the inbox and the other folders could show the Sent list.
- Folder counts of a paused mailbox do not change until the pause ends.

**Earlier fixes**
- A forward you write shows the forwarded message under the usual "Forwarded message" header, with From, Date, Subject and To. This is what the recipient gets. Before, the box showed the message under an arrow, which the mail does not have. Preview also shows the header as it is sent.
- When you answer one message with its reply arrow, one line over the box says whose mail you answer. Before, the message showed as a card, but the card is not sent. Click × on the line to answer the whole conversation.
- In a reply, the ••• under the box goes away once the quoted history is open. A "Hide quoted text" button under the history folds it again. Before, the ••• stayed where it was, so it did not show that the history was open.
- When you answer one message with its reply arrow, the reply now carries the history up to that message, as an ordinary reply does. Before, the message went as a card at the top, with no history under it, and that looked wrong in other mail apps. After such a reply, the next replies in the conversation also lost their history. If a conversation still sends no history, turn on "Quote history" in the ··· menu of the reply box.
- "… shown in Mail" and "… is hidden from Mail for now" show at the foot of the list, with the other notices. Before, they showed at the foot of the window.
- A reply you pop out opens in a window of its own. Before, it was a card over the main window.
- If you close the main window while a reply is popped out, Mail stays open with the reply. When you close the reply, the main window comes back. A click on Mail in the Dock also brings it back.
- A conversation, a person's mail or a new message that you pop out has the window buttons at the top of the page, as the main window has.
- A reply you pop out is now an ordinary window. It no longer stays in front of your other windows, also those of other apps.
- "Edit subject" in a reply opens the subject in the reply box you are using. Before, the reply moved into a card of its own.
- The title of a popped-out reply changes as you type a new subject.
- After you send a popped-out reply, its window says that the message is sending, until the window closes. Before, the window was empty.
- When you show a hidden mailbox before its schedule ends, it now hides again after 15 minutes. Before, it stayed shown until the schedule ended. To change how long, open "To show it early" in the mailbox's menu. "Never" is still a choice.
- A conversation card under a person no longer turns grey when you point at it. It stays white and lifts a little.
- In the list, the row you point at is a little darker than the list, so it does not look like the open row.
- The open row is white, with a coloured bar down its left edge.
- On an Exchange mailbox, a message you delete no longer comes back to the inbox. If it comes back once more, delete it again.
- In a long new message, the last lines no longer hide behind the signature when you change something higher up. The message and the signature scroll together.
- ⌘V pastes into the link box that ⌘K opens.
- "Forwarded to …" and "Sent" show at the foot of the list, where "Sending in…" was. Before, they showed in the corner of the window.
- A mailbox you hide by hand goes back to its schedule. If it has one, your hide lasts until the schedule next changes, and then the schedule decides again. Before, it stayed hidden until you showed it. The menu says until when: "Hidden by you until 18:00, then by your schedule".
- With a PDF or a picture open in the preview, ⌘P prints that file. Before, it printed the message under it. Other files say to open them in their own app to print.
- The preview line in the mail list is a little lighter than the names again.
- A conversation you open no longer moves up and down by a pixel or two for its first seconds.
- Error messages are in plain words. A reply that did not send says to check the internet connection, with no web address. A file that did not come says so, with no code.
- If an Exchange server does not send a file the first time, Mail asks for it once more before it tells you.
- "Scheduled" shows its count only when folder counts are on.
- The words in the mail list are darker, so they are easier to read.
- On the welcome screen, the line next to the agreement box is in line with the box.
- When you snooze several conversations at once, the next conversation opens, as it does when you archive them. If none is left, the empty inbox shows. Before, the conversation that was open before you picked them came back.

**Settings, easier to read**
- Settings is one page, with a list of its parts at the left. General comes first, then Accounts.
- Each part stands on a white card, with larger words.
- "Show counts beside folders" is now under Reading.
- You can no longer pick the colours of the window. Mail uses the colours of the Centre for Digital Habits.

**Diagnostics**
- Help > Save diagnostics (or Settings > Advanced) makes a report that helps us find a problem. It holds no mail, no addresses and no names: mailboxes are "mailbox 1", "mailbox 2", and so on.
- You can save the report as a file, or send it to us. "Send to us…" opens an email to team@digitalhabits.org with the report attached, which you can read before you send it.
- If Mail closed unexpectedly the last time, it offers the report when it starts again.

**Paused and hidden mailboxes**
- A paused mailbox has a pause mark on its tab, and a hidden one has a closed eye. A paused mailbox is no longer greyed out.
- The mailbox menu says whether you paused or hid it, or your schedule did, and until when.
- Sync says how many mailboxes are paused, and when they come back.
- The words to type to change a locked schedule stay in a small box that scrolls as you type. One unlock holds until you close the menu.

**The reply box**
- A reply under a conversation sits at the foot of the pane. Drag its edges to make it wider or taller. A taller reply covers the email; it does not push it up.
- The buttons are on one row: Send, emoji, Aa, B, I, U, bullet list, numbered list, attach, ··· and the bin.
- The quoted history of a reply folds behind a ••• button, as in Gmail.

**Undo in one place**
- When you archive, delete, move, snooze, send or discard a draft, a line at the foot of the list says so: "Archived", "Deleted", "Moved to Receipts", "Snoozed until 18:13", "Sending in 5…" or "Draft discarded", then the subject, with Undo. Before, these were messages at the foot of the window, over what you were reading or writing.
- With the list hidden, or in the Reader that fills the window, the same line is at the foot of the conversation.
- When you act on many conversations at once, one line says what they were: "GitHub stack (5)", "7 conversations" or "3 conversations and Google Ads stack (3)". One Undo, or one Cmd+Z (Ctrl+Z on Windows), brings all of them back.
- Several actions stack, newest in front, with the ones before peeking out behind it. Point at the stack to spread it out, each with its own Undo. Each Cmd+Z (Ctrl+Z on Windows) takes back the newest, then the one before.
- Each line goes after 8 seconds, and all of them wait while the pointer is on the stack. A message you send goes when it is sent.

**Send later**
- A scheduled email has the same actions everywhere: in Scheduled, at the end of its conversation, and in "This email was not sent". They are Delete, Unschedule, Edit, Change time and Send now, each with an icon.
- Delete and Unschedule say so at the foot of the list, with Undo. The email leaves Scheduled at once. It is changed only when the Undo time is over.
- Unschedule is new. It keeps the email as an ordinary draft, with its files.
- Edit opens the scheduled email itself. A heading says: "Your changes apply only when you press Send. Until then, it stays scheduled for 12:27." A time that you pick in the Send menu changes the time on Send. "Don't schedule" in the same menu keeps the email as a draft. Discard changes drops your changes. The bin deletes the scheduled email.
- With a scheduled email open, Delete or Backspace deletes it, and the next one opens.
- A draft that you send or schedule leaves Drafts at once. Undo brings it back.

**An outline of a long conversation**
- A conversation that does not fit on the screen has a narrow outline at the right: one mark for each message, yours set to the right, unread ones in green, the ones on screen darker.
- Point at it to see a list of every message, with who wrote it, its first words and its time. Click a message to go to it, also one that is not loaded yet.
- A button beside the number of messages turns the outline on or off.

**A new look**
- Mail now uses the look of the Centre for Digital Habits: a warm cream background, dark blue-green text, Schibsted Grotesk for text and Georgia for headings, and smaller corners.
- An unread conversation has a green dot to the left of its sender, and its sender and subject are in bold. The sender's name is a little larger than the subject and in a heavier weight, also in a read conversation. The conversation you have open is a white card in the list.
- A faint line separates the conversations in the list, also inside an open stack of one person's conversations.
- The messages you sent are light blue, so they are easy to tell apart from the messages you received.
- The subject of a conversation is larger and in bold. A long subject is set smaller, and wraps onto two lines when it must, so it is not cut off. The reader that fills the window shows the subject the same way.
- Beside the subject, a conversation names its people by name: "Mikkel Christoffersen and You", or "Jane Roe, You and 2 more". Point at the names to see everyone with their addresses, and to copy them or save them as a list.
- The files of a conversation follow its number of messages and its dates at the top.
- When an auto-reply is on, a small "Auto-reply on" beside Sync says so; point at it to see until when, and click it to change it. Each account it is on for has a reply arrow after its name in the tabs, also an account you have hidden. Before, the notice was a line above the tabs, which pushed the list down out of line with the conversation beside it.
- In the dark theme, the messages you sent are blue and the messages you received are a quiet slate, as in the light theme.
- The title bar and the folder list are a light sand, and so is the background behind a conversation. The list of conversations, its header and the header of a conversation are cream.
- The search field takes the free width of the title bar, up to a limit, and Sync and the other buttons are beside it. When the window is narrow, the buttons show only their icons.
- The search field and the box that filters the folder list have no fill and a thin outline until you click in them. Their words are darker, so they are easy to read.
- The folder you have open is a darker step of the folder list's colour, not white. When you point at a folder, it turns a step darker too, but less.
- The conversation you have open is a white card with round corners in the list, and a conversation you point at turns almost white. The green dot of an unread conversation sits inside its row.
- Point at the names beside a subject to see everyone with a small picture or their initials.
- A scheduled message is easy to tell from one that has gone: it is the blue of your sent messages inside a dashed blue edge, and "Sends at" is in bold blue.
- The button that opens a conversation in its own chat window is no longer above the conversation. Right-click the conversation in the list, or use its shortcut.
- The account tabs above the list stand in a thin outline, not on a grey band.
- The edge of the reply box is the blue of your sent messages. "Show quoted text" is grey, so Send is the one colour in the reply box.

**The reply box**
- The reply box is now a frame that stays still. Only the words inside it scroll, and Send is at its foot. Before, its edge could turn pale or disappear while you scrolled a long reply, and text could show under the row with Send.

**Unread only, and filters**
- At the end of the tabs, the envelope with a dot shows only your unread conversations, in every tab. Click it again to show all. It shows when the tab has unread mail. A conversation that you read while it is on stays in the list until you change the tab.
- "New list" at the end of the tabs is now "New filter", so it is not mixed up with the lists of people you send to.
- A filter can include your recipient lists, not only single people. Search for the list by its name in the filter. When people join or leave the list, the filter follows.

**Videos and sound in files**
- A video or sound file that comes with an email plays in the preview, with the usual controls. It plays only when you press play. A file over 100 MB is offered as a download only.

**Reply all and search**
- Each message in a conversation has Reply all at the top of its "…" menu, and under Reply when you right-click it. So you can reply to everyone on an earlier message, not only on the newest one. It shows when the message went to more than one person.
- Searches with `in:`, `label:`, `is:unread`, `is:read`, `is:starred`, `is:important` and `filename:` now use the copy of your mail on your computer. They are quicker and work offline. For example, `label:clients-oxford` finds the label "Clients/Oxford", and `in:trash` shows what is in Trash.

**Snoozed mail and paused mail**
- Mail that you snoozed comes back at its time, also while your mail is paused. A pause holds back new mail; a snooze is your own plan for mail that you have already seen. New mail still waits until the pause ends.
- A search of a paused mailbox finds its mail as it was when the pause began. Mail that came in during the pause stays out of the results, and out of the conversations you open, until the pause ends. Mail that you send yourself always shows.

**Replies from another mailbox**
- When you answer from a mailbox that is not connected to Mail, and copy one that is, the two conversations now link to each other. Above your reply, a line says which email it answers, with Open. Under the email, a line says that you replied, from which address and when, with Open.

**Windows**
- Shortcuts use Ctrl where the Mac uses Cmd. For example, Ctrl+Shift+A archives. The shortcut names in Mail say Ctrl too.
- Characters that you type with AltGr, such as } | and @ on a Danish keyboard, now appear. Before, they changed the size of the text in Mail.

**Folders and drafts**
- Mail you set to send later is in the Scheduled folder in the folder list, while it holds anything, and in its own conversation. It no longer stands above the list. A message that could not be sent is there too, with Try again.
- In the folder list, Drafts is under Sent, and Archived is at the top of the other column.
- The drafts folder ("Drafts from other apps" in Settings > Advanced) makes drafts for a hidden mailbox too, and also when the Mail window is behind other windows. For each draft that it makes, Mail writes a receipt with the draft's key in the folder's `made` folder.

**Disconnecting a mailbox**
- When you disconnect an account, Mail now also removes the conversations it kept ready to reopen and any unsent draft of that account, with the files on the draft. Before, these stayed on the computer until you deleted Mail's data folder.

**Users on a shared computer**
- The file Mail keeps your mail in is now open to you alone. On a Mac, every account on the computer could read it before.
- A password or a sign-in token is written over as soon as Mail is done with it. Before, it stayed in memory until something else took the space.
- An invite you open, a file you drag out of a message, and a draft handed to Outlook are cleared from the computer's temporary folder after a day. The invite and the Outlook draft stayed there before, under the name of the message they came from.

**Fixes**
- A long line at the foot of the list, such as "Sends at 11:08, if this computer is on and Mail is open", wraps. Before, it ran under Undo.
- A scheduled email that you open from Scheduled closes when you open another folder.
- In the To field, a click on a recipient that is already selected opens its card. Before, that took a double-click.
- In a narrow window, the To field's hint ("Name or email") no longer runs under Cc and Bcc.
- A reply that you schedule in a Gmail conversation shows at the end of that conversation, with its words, its time and its actions. Before, it was only in Scheduled, so you could not see in the conversation what it was going to say.
- A reply from a Gmail mailbox is sent also when Mail cannot reach Google for a moment. Before, it could fail with "Load failed" and was not kept to send later.
- Pictures up to 20 MB show in an email. Before, a picture larger than 5 MB showed as a broken frame.
- The first words of an email in the list no longer show codes such as "&zwnj;".
- The address of a link in an email signature is no longer cut off when you point at the link.
- "Sending in 5…" shows its seconds also when the subject is long.
- After you discard a draft, the next draft is selected in the list but not opened, so Backspace does not type into it. Backspace again discards it.
- The drafts of a hidden mailbox are hidden too: they are not in Drafts, not counted beside it, and not opened next.
- A file whose name has a semicolon in it keeps its whole name. Before, Mail cut the name at the semicolon, so a PDF showed as a plain "FILE", and when you forwarded the email, the file went out without ".pdf".
- A file that comes without an extension, but is a PDF or a picture, opens in the preview, and is saved with ".pdf" (or the picture's extension) on its name.
- An email whose plain text is a whole web page shows its first words in the list, not "<!DOCTYPE html …".
- With a reply open, Delete on the conversation asks "Discard draft and delete conversation?". Before, it did nothing.
- Forward puts the cursor in To every time. Before, it sometimes went nowhere when the message box opened a moment late.
- "Inbox zero — enjoy the quiet." no longer disappears for a moment once a minute, when Mail looks for new mail.
- When you snooze several conversations or a whole stack, the next conversation that opens is one that is still in the list. When none is left, the conversation closes.
- Escape closes the conversation you have open, so you see the list again. It first closes what is in front: a reply you are writing, Find, or a file you are looking at.
- A narrow email is in the middle of the Reader that fills the window, not at its left edge.
- "Load more" with only unread mail shown, or one mailbox's tab open, reads on until it finds mail that shows, or says that the older pages had none. Before, it could load mail that was then hidden, and seem to do nothing.
- With an auto-reply on and the window narrow, the search field keeps room to type.
- An email no longer moves up and down for a few seconds after you open it.
- A right-click on a conversation inside an open stack opens that conversation's own menu.
- The subject and the first words of each email in the list are a little darker, so they are easier to read.
- The eye that shows the Exchange password stays while you type, and it looks the same on Windows and on a Mac. Windows drew one of its own, but only the first time you clicked the field, and a Mac drew none.
- When you print an email, nothing in it can run. Before, the print copy was protected less strictly than the email on the screen.
- While a file is still loading for its preview, the preview says "Opening…". Before, it said "preview not available" for a moment.
- When an email has more than one file, the arrows and the "1 / 4" count show over the preview, so you can go through the files. Before, they were behind the preview.
- After the computer sleeps for a long time, Mail no longer asks you to reconnect a mailbox. It gets a new sign-in in the background.
- A stack that you have open stays in its place in the list until you open something else. Before, when you deleted its newest conversation, the stack could move down the list at once.
- The reply box keeps its size when there is a lot above it. Before, it could shrink to a thin line, and its text and Send showed below it.
- A list of choices in a small panel, for example "Automatically hide again after", opens in full and does not move the panel.
- In the box of words that you type to show a hidden mailbox early, the words you type correctly turn green, and the first wrong letter or space is red.
- The folder list is a little darker than the list of conversations, and the small grey words in the list (TODAY, the time of a read email) are darker, so they are easier to read.
- When you delete, archive or move a conversation that you opened from a stack, the next conversation in that stack opens.
- Menus open in front of what they were opened from: the menu beside Send in a reply that fills the window, and the menu beside Download when you look at a file.
- You can scroll an email as soon as you open it, also with the pointer on the email itself. Before, it could jump back to the top, or to the newest message, for a few seconds.
- After you click a link or text in an email, Delete, Archive, Reply and the other shortcuts work. Before, they did nothing until you clicked the conversation in the list again.
- When you turn Stacks off, each conversation slides down out of its stack, and all are in place within about a second. Before, they moved up and down the list.
- The round knob of every switch is in the middle, with the same space on each side.
- The links on the welcome screen open one browser tab. Before, they opened two.
- In the dark theme, the quoted history under a reply is easy to read, and the marks in a conversation's outline are softer.
- The reply that floats over the window keeps its right edge.
- At a smaller Text size, the title bar keeps clear of the window buttons on the Mac.
- When you drag a file from Mail to the desktop, its icon is the usual size. Before, the icon was very large.
- In a time box (Snooze, Send later, hours), you can delete one digit and type another in its place. Before, the box changed the time to 00:00 and moved the cursor to the end.
- A file that is open in Mail no longer shows a grey line down the middle of the page.
- The hint in an empty search field is no longer cut off before the end of the field.
- The dates at the top of a conversation run from its first message to its newest, also when you have gone to an older message in it.
- A conversation that reached two of your mailboxes shows the replies you sent from the other one, also when it is read from Outlook or from Gmail directly.
