# WhatsApp Contacts and DM Exporter

Minimal, privacy-first Chrome extension to export WhatsApp Web contacts, conversations, and group participants to Excel or CSV.

Developed by satydev (satuxcodes)
Repository: https://github.com/sxtyx-bugs

---

## Overview

WhatsApp Contacts and DM Exporter is a lightweight extension running entirely within WhatsApp Web in Google Chrome and Chromium-based browsers. It allows users to filter, organize, and export contact information directly from memory into structured spreadsheet files with zero third-party dependencies or external servers.

The extension features a monochrome interface integrated directly into the WhatsApp Web navigation bar and floating action controls, providing one-click filtering presets tailored for businesses, sellers, community organizers, and researchers.

---

## Key Features

### Lead and Customer Extraction
Designed specifically for merchants, sellers, and creators managing high DM volumes. Isolate new or unsaved customer inquiries with a single click by filtering out your personal address book.

### Accurate Contact Identity Resolution
Modern WhatsApp Web uses Linked Identity (LID) records that often mask phone numbers and contact flags. This extension cross-references internal contact models, phonebook records, and device directories to accurately resolve whether an identity is saved in your contacts.

### Flexible Export Formats
- Excel Workbook (.xlsx): Native binary spreadsheet generated client-side without external libraries, preserving cell types and text encoding.
- Comma-Separated Values (.csv): Exported with UTF-8 Byte Order Mark (BOM) to guarantee clean display of international characters, country codes, and leading zeros in Microsoft Excel, Apple Numbers, and Google Sheets.

### Filter Engine
- Presets: Customer Leads (unsaved DMs only), All Contacts and DMs, Active Group.
- Inclusion Controls: Individual chats, saved contacts, active group members.
- Exclusion Controls: Exclude already saved contacts, exclude your own number, exclude business accounts.

### Zero Telemetry and Client-Side Security
All operations run locally within your active browser session. No data is stored, transmitted, or logged outside your local computer.

---

## Export Schema

Every export outputs a structured dataset containing the following nine columns:

| Column | Description |
|---|---|
| Country Code | International dialing prefix (e.g., +1, +44, +91) |
| Country | Country name identified from phone prefix |
| Phone Number | Full international phone number formatted for spreadsheets |
| Public Display Name | Profile display name or pushname set by the user |
| Saved Name | Name saved in your phone contacts (if applicable) |
| Source | Context origin (Direct Chat, Group Participant, Saved Contact) |
| Is My Contact | True if saved in your address book, False otherwise |
| Is Business | True if verified or designated as a WhatsApp Business account |
| Last Chat | Timestamp or readable date of the most recent message |

---

## Installation

1. Download or clone this repository to your local machine:
   ```bash
   git clone https://github.com/sxtyx-bugs/WhatsApp-Group-Contacts-Exporter-main.git
   ```

2. Open Google Chrome (or any Chromium browser like Brave, Edge, or Arc).

3. Navigate to the extensions page:
   ```
   chrome://extensions
   ```

4. Enable "Developer mode" using the toggle in the upper-right corner.

5. Click "Load unpacked" in the top-left toolbar.

6. Select the folder containing `manifest.json`.

7. Navigate to WhatsApp Web:
   ```
   https://web.whatsapp.com
   ```

8. Once WhatsApp Web finishes loading, use the "Export" button in the chat list header or the floating action pill in the bottom-right corner.

---

## Usage Guide

### Scenario 1: Exporting Unsaved Customer Leads
If you receive hundreds of customer inquiries and need to import only unsaved prospects into your CRM:
1. Open WhatsApp Web.
2. Click the floating "Export" button or click "Export" in the left sidebar header.
3. In the Filter dialog, select "Customer Leads".
4. Choose your preferred format (.xlsx or .csv).
5. Click "Export Contacts".

### Scenario 2: Exporting Members from a Group
1. Open the target group in WhatsApp Web.
2. Click the "Export" button.
3. In the dialog, select "Active Group".
4. Toggle "Exclude My Contact" if you wish to separate strangers from known contacts.
5. Click "Export Contacts".

### Scenario 3: Complete Backup of Contacts and Conversations
1. Click the "Export" button.
2. Select "All Contacts & DMs".
3. Select your output format and download the full roster.

---

## Project Structure

```
WhatsApp-Group-Contacts-Exporter/
|-- manifest.json          # Chrome Extension Manifest (V3)
|-- src/
|   |-- content.js         # Core extraction logic and UI injection
|   |-- countries.js       # International phone prefix mapping
|   |-- xlsx-writer.js     # Standalone client-side Excel builder
|   |-- styles.css         # Monochrome interface stylesheet
|-- popup/
|   |-- popup.html         # Extension popup view
|   |-- popup.js           # Extension popup controls
|-- icons/                 # Extension icon assets
|-- docs/                  # Documentation assets
|-- README.md              # Project documentation
|-- LICENSE                # MIT License
```

---

## Technical Specifications

- Manifest Version: 3
- Execution Environment: `MAIN` world content script for direct access to WhatsApp Web stores
- Permissions: `scripting`, `host_permissions: https://web.whatsapp.com/*`
- External Dependencies: None
- Compatibility: Google Chrome, Microsoft Edge, Brave, Opera, Arc

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

Developed by satydev (satuxcodes): https://github.com/sxtyx-bugs
