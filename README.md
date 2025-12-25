# Video Sync

A Chrome extension that enables real-time video synchronization between multiple users using peer-to-peer WebRTC connections.

Watch videos together with friends - when one person plays, pauses, or seeks, everyone stays in sync!

## Features

- **P2P Video Sync** - Synchronize video playback across multiple browsers using WebRTC
- **Host/Guest Model** - Host controls playback, guests follow automatically
- **Easy Sharing** - Generate invite links to share with friends
- **Auto-Redirect** - Guests are automatically redirected to the host's video
- **Nickname Support** - Set display names for easier identification
- **Toast Notifications** - See sync events and peer activity on the video
- **Customizable Settings** - Adjust sync interval, offset tolerance, and notification preferences
- **Works on Most Sites** - YouTube, Netflix, and any site with HTML5 video

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the extension folder

## Usage Guide

### Hosting a Watch Party

1. Navigate to a page with a video (e.g., YouTube)
2. Click the Video Sync extension icon in your toolbar
3. (Optional) Set your nickname and click **Save**
4. Click **Copy Invite Link** to copy the shareable link
5. Share the link with friends, this requires your guests to have the extension installed

When guests join, you'll see them listed in the popup. As the host:
- Your play/pause/seek actions sync to all guests
- You can kick individual guests with the **X** button
- Click **End Party** to disconnect everyone

### Joining a Watch Party

#### Option 1: Via Invite Link
1. Click the invite link shared by the host
2. You'll be automatically connected and redirected to the host's video

#### Option 2: Manual Connection
1. Get the host's ID (they can copy it from the extension popup)
2. Click the Video Sync extension icon
3. Paste the host's ID in the "Host's ID" field
4. Click **Connect**

As a guest:
- Video playback is controlled by the host
- You can request host control with the **Request Host Control** button
- Click **Leave Room** to disconnect
- You can share the invite link too

### Transferring Host Control

The current host can promote any guest to become the new host:
1. Find the guest in the "Connected Peers" list
2. Click the **Promote** button next to their name

Guests can also request control:
1. Click **Request Host Control**
2. The host will see the request and can choose to promote you

## Settings

Access settings via the **Settings** link in the extension popup, or right-click the extension icon → **Options**.

| Setting | Description | Default |
|---------|-------------|---------|
| **Sync Interval** | How often to sync playback state (ms) | 1000 |
| **Allowed Offset** | Time difference before forcing sync (seconds) | 0.3 |
| **Toast Notifications** | Show/hide sync notifications on video | Enabled |
| **Toast Duration** | How long notifications display (ms) | 1500 |

## How It Works

- Uses **PeerJS** (WebRTC) for direct peer-to-peer connections
- No central server required for video data - connections are direct between browsers
- The **host** periodically broadcasts their video state (time, play/pause)
- **Guests** receive updates and adjust their video to match
- URL changes by the host trigger navigation for all guests

## Browser Support

- Google Chrome (Manifest V3)
- Other Chromium-based browsers

## Limitations

- Only works with HTML5 `<video>` elements
- Some sites with DRM (e.g., Netflix) may have restrictions
- Cannot inject into browser internal pages (`chrome://`, `brave://`, etc.)

## Privacy

- All connections are peer-to-peer (P2P)
- No video data passes through external servers
- PeerJS signaling server is only used to establish initial connections
- Your video URL is shared with connected peers for auto-redirect

## License

MIT License
