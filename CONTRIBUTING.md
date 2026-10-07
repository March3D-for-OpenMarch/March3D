# Contributing to March3D

Thanks for your interest in contributing to March3D!

## Getting Started

1. Fork the March3D repository.
2. Clone your fork:

   git clone https://github.com/March3D-for-OpenMarch/March3D.git

3. Enter the project:

   cd March3D

4. Install dependencies:

   npm install

5. Start March3D in development mode:

   npm run dev

## Making Changes

Create a new branch for your change:

git checkout -b feature/my-feature

Please avoid making changes directly on `main`.

Examples:

feature/improved-marching-animation
fix/openmarch-sync-freeze
fix/field-hashes
feature/new-instrument-model

## Pull Requests

When you're finished:

1. Commit your changes.
2. Push your branch to your fork.
3. Open a Pull Request against March3D's `main` branch.
4. Explain what your change does.
5. Include screenshots or videos for visual changes when possible.

Please keep Pull Requests focused on one feature or fix.

## Bug Reports

When reporting a bug, please include:

- March3D version
- OpenMarch version, if applicable
- Windows version
- Steps to reproduce the issue
- Screenshots or videos when useful
- The `.dots` file if the problem is drill-specific and the file can be shared

## Building March3D

Create the Windows installer with:

npm run dist:win

## OpenMarch Sync

Changes involving OpenMarch synchronization should be tested both:

- With March3D running standalone
- With March3D connected to OpenMarch

## Code Contributions

Contributions are welcome for:

- 3D rendering
- Performer models
- Instruments
- Marching animations
- Field rendering
- OpenMarch integration
- Playback
- Audio synchronization
- Performance improvements
- UI/UX
- Documentation
- Bug fixes

Thank you for helping improve March3D!
