# Karaoke MVP — Product Requirements Document

## Objective
Create a web-based karaoke request system that allows customers in a karaoke venue to join via QR, search karaoke tracks, request songs and participate in a fair queue controlled by the venue.

## Actors
### Participant
- joins through QR
- enters a display name / alias
- searches songs
- requests songs
- sees their requests and approximate queue state

### Operator
- manages the room
- can remove or move requests
- can skip / pause / resume
- can switch approval mode
- controls venue configuration

### Player
- runs on the main karaoke PC
- displays lyrics/video fullscreen
- sends video through HDMI to the venue screens

## Core MVP flow
1. Operator opens a karaoke room.
2. Room displays a QR code.
3. Participant scans the QR.
4. Participant enters an alias.
5. Participant searches for a song.
6. Participant submits a request.
7. Backend validates participant limits and room rules.
8. Request enters the existing queue.
9. Existing round-robin logic orders participants fairly.
10. Player reproduces the next track.
11. Participant can add more tracks when they are below the pending limit.

## Queue rules
All rules are configurable per room.

Initial defaults:
- maxPendingPerParticipant = 2
- maxSongsPerParticipantRound = 1
- houseTracksBeforeParticipant = 2
- approvalMode = AUTO
- rotationMode = FAIR

## Fair rotation
If users request multiple songs, one user must not monopolize the queue.

Example:
Juan 1
Maria 1
Pedro 1
Juan 2
Maria 2

## Venue / house tracks
The venue may have house tracks that are inserted between customer turns.

Initial configurable rule:
- play N house tracks before returning to participant requests

## Approval modes
AUTO:
- valid requests enter the queue automatically

MANUAL:
- operator must approve requests before they become active

## Song sources
MVP supports:
- existing local Karaoke Eternal library
- YouTube

YouTube integration should use:
- YouTube Data API for search
- YouTube IFrame Player API for playback

## Out of scope for MVP
- multi-tenant SaaS
- offline mode
- native Android/iOS apps
- payments
- reservations
- WhatsApp login
- scoring / microphone analysis
- AI singer evaluation
- centralized multi-venue administration
