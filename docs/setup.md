# Setting up Home and your devices

East Room runs on one computer, called Home here. Your phone and tablet open the same app from Home, keep a copy of what you are reading, and work without Home when it is asleep or you are out.

## 1. Run Home

Open East Room from its icon (the [install](../README.md#start-in-three-steps) made it), or type `eastroom` in a terminal. Either way it serves your library at `http://127.0.0.1:4800` and shows it in your browser. Opened a second time, it shows the one that is already running.

Home listens on `127.0.0.1` only. Nothing else on your Wi-Fi can reach it.

To have it running whenever the computer is on, open Settings on a Mac, then Devices, and turn on "Start with the computer". Home then starts by itself at every login.

## 2. Reach it from your own devices

East Room does not open itself to a network. Put a private network in front of it. I use [Tailscale](https://tailscale.com/), which is free for personal use: install it on Home and on each device, sign in with the same account, then on Home:

```sh
tailscale serve --bg --https=10000 http://127.0.0.1:4800
tailscale serve status      # prints the address, like https://home.your-tailnet.ts.net:10000
```

Now tell Home that pages from that address may save to the library. Without this, devices can read but their place and kept lines are refused. Stop Home if it is running (close its window on Windows, restart the computer on a Mac), then start it from a terminal with the address:

```sh
eastroom --origin https://home.your-tailnet.ts.net:10000
```

Use the address exactly as printed: scheme, name and port. If a device shows "Home refused this address", the line under it names the address to pass.

Things to know:

- The address only works on devices signed in to your Tailscale account. `tailscale serve` is private. `tailscale funnel` is public: do not use it for East Room.
- The machine name is part of the address and ends up in a public certificate log. If the name says something you would rather keep private, rename the machine in Tailscale first.
- To stop serving: `tailscale serve --https=10000 off`.

## 3. Put it on the phone

1. Open the address in Safari (iPhone, iPad) or Chrome (Android).
2. Share, then "Add to Home Screen". On Android: menu, then "Install app".
3. Open East Room from the new icon.

Opened from the icon, the app keeps its own storage, so the books you are reading stay on the device. In a normal browser tab the browser may clear them after a few weeks without a visit.

What a device keeps without being asked: the app itself, the text of every unfinished book, and narration for the part you are in and the two after it. "Keep on this device" on a book keeps all of its narration, for a flight for example.

## 4. Narration

Narration is made at Home, in the background, for the books you are reading. It starts at your place and works towards the end of the book. With the voice installed you can also start it from the app: Settings, Workshop, then "Do" beside a book, or "Recorded voice, ahead of your reading" for every book you are in.

```sh
uv tool install --force "eastroom[pdf,voice] @ https://github.com/intesarjawad/eastroom/archive/refs/heads/main.tar.gz"
eastroom --voice plain            # leave it running; Ctrl+C stops it and keeps what is finished
```

The first line is the install again with the voice added. uv is already on your computer: the installer put it there.

`plain` is a small voice model (Kokoro) that runs on any recent computer several times faster than real time. The first run downloads about 350 MB and checks the files against known checksums. It needs `ffmpeg` to pack the audio; on a Mac the built-in `afconvert` is used when `ffmpeg` is missing.

On a Mac with an Apple chip there is a second, slower voice that copies a reference recording:

```sh
uv tool install --force "eastroom[pdf,voice,storyteller] @ https://github.com/intesarjawad/eastroom/archive/refs/heads/main.tar.gz"
# put ref.wav (10 to 20 seconds of the voice) and ref.txt (the words spoken in it) in ~/.eastroom/storyteller/
eastroom --voice storyteller
```

It replaces the plain take chapter by chapter. It needs several GB of free memory and stops with a message when there is not enough.

While a narrator runs on a Mac, the machine is kept from idle sleep. A closed laptop lid still sleeps.

What you hear, best first: the storyteller, then narration a book already had, then the plain voice, then the device's own voice, then the light alone. The reader says which one is playing.

## 5. Settings and the workshop

Open Settings from the library. It has five rooms.

| Room | What is in it |
|---|---|
| Reading | Text size, pace, sounds, the recap at the start of a part, which voice reads |
| Workshop | What Home is making now, what each book has, and a button to make the rest |
| Engines | Who looks at covers and who reads sentences, the AI tools and servers Home can ask, which voices are installed, whether PDFs can be read |
| Storage | The room each book takes, rules for tidying recorded voice, and what was removed in the last seven days |
| Devices | The address your other devices open, this device's name and its own copy, the devices that have met Home, starting Home at login (macOS), a backup of every reading record |

The installer includes what PDFs need. If you installed East Room another way, add the `pdf` extra to the package.

Two jobs can use a model, and both are optional: matching a spine's lettering to its cover, and choosing key lines among the ranked sentences. Under Engines, choose who does each:

- **An AI tool on Home.** Claude Code, Codex, agy or OpenCode, if it is installed and signed in. East Room starts it in an empty folder, asks one question and reads the answer. What it is asked goes to that tool's service. Claude Code is started with no tools at all. Codex is started read-only, agy and OpenCode in their planning mode, and those three still load the servers you connected to them. For a book you do not trust, choose Claude Code or a server.
- **A server.** Anything that speaks the OpenAI chat API. [Ollama](https://ollama.com/) and LM Studio run on your computer and need no key. For a service such as OpenRouter, paste your key once. Home keeps it in `secrets.json` in the library, readable only by you, and never shows it again.

"Try it" asks one small question and tells you how long the answer took. Then press "Match all" in the Workshop. Without an engine the spines use the built-in styles and key lines are ranked without a model.

Removing a book keeps your place and your kept lines. Everything removed can be brought back from Storage for seven days.

## When something is off

| You see | Cause | Do |
|---|---|---|
| "Home is not answering" | Home is asleep, or the device is not on your private network | Keep reading. Changes wait on the device and are sent when Home answers. |
| "Home refused this address" | Home was started without `--origin` for this address | Restart Home with the address shown |
| No voice on iPhone with the device voice | The silent switch mutes the built-in voice | Turn silent mode off. Recorded narration is not affected. |
| "This file is locked by its shop (DRM)" | The EPUB has copy protection | East Room cannot open it |
