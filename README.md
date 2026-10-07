# March3D

March3D is a 3D drill viewer for [OpenMarch](https://openmarch.com/) designed to visualize marching band drill in real time.

It can run as a standalone application or synchronize with OpenMarch for playback, drill changes, and file loading.

## Features

- 3D football field rendering
- High School and NCAA-style field markings
- Yard lines, numbers, hashes, and end zones
- 3D marcher models
- Instrument models for winds and percussion
- Color guard equipment support
  - Flags
  - Rifles
  - Dancers with no equipment
- Marching animations
  - Forward marching
  - Backward marching
  - Slides
  - Drumline crab stepping
- Step-size-aware marching
- Left/right foot timing
- Tempo-synchronized playback
- Embedded or external audio support
- Set/count/time playback display
- OpenMarch synchronization
- Automatic loading of the drill currently open in OpenMarch
- Windows installer support
- Automatic OpenMarch plugin installation

## OpenMarch Sync

When March3D is connected to OpenMarch, it can:

- Automatically open the `.dots` file currently loaded in OpenMarch
- Follow OpenMarch playback
- Follow OpenMarch play/pause state
- Follow timeline position
- Reload when the OpenMarch drill changes

The installer automatically installs the March3D OpenMarch sync plugin to:

```text
%APPDATA%\OpenMarch\plugins
```

## Requirements

For development:

- Node.js
- npm
- Windows, macOS, or Linux for development
- Windows for building the Windows installer
- macOS for building the macOS installer

End users do **not** need Node.js or npm.

## Development

Clone the repository:

```bash
git clone https://github.com/March3D-for-OpenMarch/March3D
cd March3D
```

Install dependencies:

```bash
npm install
```

Start the development version:

```bash
npm run dev
```

## Build

Build the application:

```bash
npm run build
```

## Build Windows Installer

To create a Windows installer:

```bash
npm install
npm run dist:win
```

## Build Mac Installer

To create a Mac installer:

```bash
npm install
npm run dist:mac
```

The installer will be generated in:

```text
release/
```

Example:

```text
March3D Setup 0.3.32.exe
```

Users can install March3D normally and launch it from the Desktop or Start Menu without using a terminal.

## Project Structure

```text
March3D/
├── src/
│   ├── assets/
│   ├── lib/
│   ├── viewer/
│   └── App.tsx
│
├── electron/
│   ├── main.ts
│   └── preload.ts
│
├── types/
│
├── openmarch-plugin/
│   └── March3DSync.om.js
│
├── build/
│   └── icon.ico
    └── icon.icns
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

## `.dots` Files

March3D reads OpenMarch `.dots` files directly.

It uses drill information including:

- Marcher positions
- Sections
- Pages / sets
- Beats
- Tempo
- Field dimensions
- Field checkpoints
- Yard number positions
- Hash positions
- Audio information

## Windows Installer

March3D uses Electron Builder with NSIS to create a normal Windows installer.

The installer can:

- Install March3D
- Create a Desktop shortcut
- Create a Start Menu shortcut
- Install the OpenMarch sync plugin
- Remove the plugin when March3D is uninstalled

## Mac Installer

March3D uses Electron Builder to create a MacOS DMG File.

The DMG can:

- Install March3D


## OpenMarch Plugin Location

The March3D sync plugin is installed to:

```text
%APPDATA%\OpenMarch\plugins\March3DSync.om.js
```

Restart OpenMarch after installing or updating March3D so the latest plugin version is loaded.

## Current Version

**March3D v0.3.33**

## Status

March3D is currently in active development.

Some features, models, animation behavior, and OpenMarch synchronization may change as development continues.

## Credits

March3D is designed to work alongside OpenMarch.

OpenMarch is a separate project and is not bundled with March3D.
