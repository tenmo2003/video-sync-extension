# Video Sync Extension - Data Flow Documentation

This document describes the architecture and data flow of the Video Sync browser extension.

## Architecture Overview

The extension consists of four main components:

```mermaid
graph TB
    subgraph "Browser Extension"
        P[popup.js<br/>Extension UI]
        B[background.js<br/>Service Worker]
        C[content.js<br/>Video Page Script]
        O[offscreen.js<br/>WebRTC/PeerJS]
    end

    subgraph "External"
        PS[PeerJS Server<br/>Signaling]
        RP[Remote Peer<br/>Other User]
    end

    P <-->|chrome.runtime| B
    C <-->|chrome.runtime| B
    B <-->|chrome.runtime| O
    C <-->|chrome.tabs.sendMessage| P
    O <-->|WebRTC via PeerJS| PS
    O <-->|P2P Data Channel| RP
```

### Component Responsibilities

| Component | File | Purpose |
|-----------|------|---------|
| **Popup** | `popup.js` | User interface for connection management |
| **Background** | `background.js` | Message router between components |
| **Content Script** | `content.js` | Video element control and sync |
| **Offscreen Document** | `offscreen.js` | WebRTC peer connections via PeerJS |

## Message Flow Diagrams

### 1. Peer Initialization

When the popup opens, it initializes or retrieves the peer connection:

```mermaid
sequenceDiagram
    participant P as Popup
    participant B as Background
    participant O as Offscreen
    participant PS as PeerJS Server

    P->>B: INIT_PEER
    B->>B: Get nickname from storage
    B->>O: INIT_PEER (+ tabId, tabUrl, nickname)
    O->>PS: Create new Peer()
    PS-->>O: Peer ID assigned
    O->>B: PEER_INFO (id, connectedPeers, isHost)
    B-->>P: PEER_INFO
```

### 2. Connection Establishment (Manual)

When a guest connects to a host using their ID:

```mermaid
sequenceDiagram
    participant GP as Guest Popup
    participant GB as Guest Background
    participant GO as Guest Offscreen
    participant HO as Host Offscreen
    participant HC as Host Content

    GP->>GB: CONNECT_TO (targetId)
    GB->>GO: CONNECT_TO (+ tabId)
    GO->>HO: PeerJS connect()
    HO-->>GO: Connection established
    GO->>GB: CONNECTION_STATUS ("Connected")
    GO->>GB: CONNECTED_PEERS_UPDATE
    HO->>HC: NOTIFY_PEER_JOINED
    Note over GO,HO: Both peers exchange NICKNAME_UPDATE
```

### 3. Invite Link Auto-Connect

When a user opens an invite link with `?videosync_host=<id>`:

```mermaid
sequenceDiagram
    participant C as Content Script
    participant B as Background
    participant O as Offscreen
    participant H as Host Offscreen

    C->>C: Detect videosync_host param
    C->>C: Clean URL (remove param)
    C->>B: AUTO_CONNECT (hostId)
    B->>B: Get nickname from storage
    B->>O: AUTO_CONNECT (+ tabId, tabUrl, nickname)
    O->>O: Create Peer if needed
    O->>H: PeerJS connect()
    H-->>O: Connection established
    O->>B: CONNECTION_STATUS
```

### 4. Video Sync Flow (Host → Guests)

How video events are synchronized from host to guests:

```mermaid
sequenceDiagram
    participant HV as Host Video
    participant HC as Host Content
    participant HB as Host Background
    participant HO as Host Offscreen
    participant GO as Guest Offscreen
    participant GC as Guest Content
    participant GV as Guest Video

    HV->>HC: play/pause/seeked event
    HC->>HB: VIDEO_EVENT (action, time, timestamp)
    HB->>HO: VIDEO_EVENT (+ tabId)
    HO->>GO: P2P: {action, time, timestamp}
    GO->>GC: INCOMING_ACTION → APPLY_ACTION
    GC->>GV: Apply action (play/pause/seek)
```

### 5. Periodic Sync (Background Sync)

The host periodically sends sync state to keep guests aligned:

```mermaid
sequenceDiagram
    participant HC as Host Content
    participant HB as Host Background
    participant HO as Host Offscreen
    participant GO as Guest Offscreen
    participant GC as Guest Content

    loop Every syncInterval (default 1000ms)
        HC->>HB: VIDEO_EVENT (action: "sync", time, paused)
        HB->>HO: VIDEO_EVENT (+ tabId)
        HO->>GO: P2P: sync data
        GO->>GC: APPLY_ACTION
        GC->>GC: Check time drift > allowedOffset
        alt Drift detected
            GC->>GC: Adjust video.currentTime
        end
    end
```

### 6. Host Promotion Flow

When a host promotes a guest to become the new host:

```mermaid
sequenceDiagram
    participant HP as Host Popup
    participant HO as Host Offscreen
    participant GO as Guest Offscreen
    participant GC as Guest Content

    HP->>HO: PROMOTE_PEER (peerId)
    HO->>HO: Set isHost = false
    HO->>GO: P2P: HOST_TRANSFER (newHostPeerId)
    GO->>GO: Disconnect from old host
    GO->>GO: Set isHost = true
    GO->>GC: ROLE_UPDATE (isHost: true)
    Note over GO: New host now broadcasts sync
```

## Message Types Reference

### Popup → Background → Offscreen

| Message Type | Description | Key Data |
|--------------|-------------|----------|
| `INIT_PEER` | Initialize peer connection | tabId, tabUrl, nickname |
| `CONNECT_TO` | Connect to a host | targetId |
| `DISCONNECT_PEER` | Disconnect specific peer | peerId |
| `DISCONNECT_ALL` | Leave room / End party | - |
| `REQUEST_HOST` | Request host control | - |
| `PROMOTE_PEER` | Transfer host to peer | peerId |
| `UPDATE_NICKNAME` | Update display name | nickname |

### Content Script → Background → Offscreen

| Message Type | Description | Key Data |
|--------------|-------------|----------|
| `VIDEO_EVENT` | Video state change | action, time, timestamp, paused |
| `VIDEO_CHANGED` | Video URL changed | newUrl |
| `NO_VIDEO_DISCONNECT` | No video on page | - |
| `GET_CONNECTION_STATE` | Query connection status | - |
| `AUTO_CONNECT` | Auto-connect from invite | hostId |

### Offscreen → Background → Popup/Content

| Message Type | Destination | Description |
|--------------|-------------|-------------|
| `PEER_INFO` | Popup | Peer ID and connection info |
| `CONNECTION_STATUS` | Popup | Status message display |
| `CONNECTED_PEERS_UPDATE` | Popup | Updated peer list |
| `ROLE_UPDATE` | Popup + Content | Host/guest role change |
| `INCOMING_ACTION` → `APPLY_ACTION` | Content | Video sync command |
| `NOTIFY_PEER_JOINED` → `PEER_JOINED` | Content | Peer join notification |
| `NOTIFY_VIDEO_NAVIGATE` → `VIDEO_NAVIGATE` | Content | Navigate to new video |

### P2P Messages (via PeerJS Data Channel)

| Message Type | Description |
|--------------|-------------|
| `NICKNAME_UPDATE` | Share nickname with peer |
| `HOST_REQUEST` | Request to become host |
| `HOST_TRANSFER` | Transfer host role |
| `HOST_CHANGED` | Notify of new host |
| `REDIRECT_TO_HOST` | Redirect connection to actual host |
| `VIDEO_NAVIGATE` | Host changed video URL |
| `NO_VIDEO_LEFT` | Host left video page |
| Video sync data | `{action, time, timestamp, paused}` |

## Data Storage

```mermaid
graph LR
    subgraph "chrome.storage.sync"
        N[nickname]
        SI[syncInterval]
        AO[allowedOffset]
        TE[toastEnabled]
        TD[toastDuration]
    end

    subgraph "offscreen.js Memory"
        TP[tabPeers Map]
        TP --> TD1[tabId → tabData]
        TD1 --> P[peer: Peer]
        TD1 --> C[connections: Map]
        TD1 --> IH[isHost: boolean]
        TD1 --> PN[peerNicknames: Map]
    end
```

## Component Interaction Summary

```mermaid
graph LR
    subgraph "User Actions"
        UA1[Click Connect]
        UA2[Play/Pause Video]
        UA3[Copy Invite Link]
    end

    subgraph "Extension Flow"
        P[Popup]
        C[Content]
        B[Background]
        O[Offscreen]
    end

    subgraph "Network"
        WR[WebRTC P2P]
    end

    UA1 --> P --> B --> O --> WR
    UA2 --> C --> B --> O --> WR
    UA3 --> P
    WR --> O --> B --> C
    WR --> O --> B --> P
```
