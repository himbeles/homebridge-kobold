## Unreleased

## 2.0.0 (2026-08-08)

This release summarizes all changes since 1.1.2.

### Before upgrading

* Node.js 24 is now required. Homebridge 1.8 remains supported for existing HAP/HomeKit accessories; native Matter accessories require Homebridge 2
* Existing HAP-only installations keep their current accessories and configuration without migration. Matter is optional and controlled through the Homebridge bridge or child-bridge settings
* Pairing both the HAP and Matter versions of a robot to the same home creates two robot accessories. Use a dedicated child bridge when Matter-only exposure is preferred

### Added

* Native Matter robotic-vacuum support, including run and clean modes, start, pause, resume, return to dock, operational and battery state, Identify, and room selection through Matter Service Areas
* HAP and Matter transport declarations so Homebridge UI can identify both supported protocols
* Matter pairing and bridge-configuration guidance in the plugin settings and README

### Changed

* Moved protocol exposure to Homebridge bridge settings: HAP remains available by default, while Matter accessories are added automatically when Matter external accessories are enabled
* Replaced the legacy `homebridge-lib` integration with the current Homebridge API
* Improved adaptive polling and state synchronization while preventing overlapping Kobold cloud requests
* Limited the published npm package to runtime files, documentation, and metadata

### Fixed

* Preserved cached HAP and Matter accessories when robot discovery or refresh fails, retaining the last known state until the robot is reachable again
* Preserved stable Matter accessory, map, and room identities plus selected areas and clean mode across Homebridge restarts
* Added Matter command timeouts, error propagation, and capability validation so failed cloud operations do not publish misleading state

## 2.0.0-beta.2 (2026-08-07)

### Fixed

* Preserved the clean mode selected by Matter controllers while the robot is idle, so Energy Saving mode can be disabled in Apple Home and the selected mode is used for the next cleaning cycle

## 2.0.0-beta.1 (2026-08-05)

### Changed

* Moved protocol exposure control exclusively to Homebridge bridge settings; the plugin now always provides its HAP accessory and automatically adds Matter when the bridge enables Matter external accessories
* Declared both `supports-hap` and `supports-matter` package transports so Homebridge UI shows Matter support while retaining HAP-enabled child-bridge defaults
* Added bridge-configuration guidance, including dedicated-child-bridge instructions for Matter-only use
* Added change-only Matter state publishing for run mode, clean mode, operational state, battery, and Service Areas
* Made robot refresh failures retain the last published state and abort Matter commands that cannot validate current robot capabilities

### Fixed

* Added error propagation, contextual logging, and a 30-second timeout to callback-based Matter robot commands

## 2.0.0-beta.0 (2026-08-05)

### Added

* Native Matter robotic-vacuum support for Homebridge 2, including run and clean modes, start, pause, resume, return to dock, operational and battery state, Identify, and room selection through Matter Service Areas
* Config UI sections for exposure and HomeKit-specific settings, including protocol trade-offs and directions to the Matter pairing codes

### Changed

* Updated state synchronization and adaptive polling to keep HomeKit and Matter accessories current without overlapping cloud requests
* Replaced the legacy `homebridge-lib` and direct `hap-nodejs` integration with the Homebridge API
* Standardized development, testing, and npm publishing on Node.js 24, with release validation covering lint, build, and Matter tests
* Limited the npm package to release artifacts and excluded local Homebridge test state that may contain credentials and pairing data

### Fixed

* Preserved stable Matter accessory, map, and room identities across restarts
* Prevented cached external Matter accessories from losing their live endpoint after restart

## 0.1.0

* Added start and pause cleaning
* Added return to base
* Added enable and disable schedule
* Added enable and disable eco mode
* Added battery info

## 0.2.0

* Added dock info
* Improved logging to use a debug library

## 0.2.1

* Improved the go to dock command

## 0.3.0

* Added periodic refresh of robot state while cleaning
* Added optional periodic refresh of robot state while not cleaning
* Added error messages when cant login or get robot
* Improved go to dock switch to be enabled as soon as possible without manual refresh
* Improved switches to indicate the time an action needs to complete
* Improved eco mode to not be overwritten by robot state update

## 0.3.1

* Added support for Neato BotVac D5 Connected

## 0.3.2

* Fixed a bug that refresh is not disabled when set to 0

## 0.4.0

* Added support for multiple robots
* Added log output when user requests accessory identify
* Changed plugin to platform instead of single accessory
* Removed parameter name from config

## 0.4.1

* Added config parameter for extraCareNavigation

## 0.4.2

* Added config parameter to disable switches/sensors

## 0.4.4

* Fixed config parameter to disable switches/sensors not optional

## 0.4.5

* Fixed compatibility with homebridge 0.4.23 (occupancy sensor not working)

## 0.4.6

* Added error log while refreshing robot state
* Fixed a rare bug where the robot stops after some seconds of cleaning

## 0.4.7

* Fixed an exception when no robot is associated with the account

## 0.5.0

* Added noGo lines button
* Added extra care navigation button
* Added syncing cleaning options from last run
* Added option to disable background state update completely
* Changed goto dock button is now always off
* Changed error handling
* Changed debug messages
* Updated node-botvac dependency to 0.1.6
* Removed extra care navigation option parameter (is now a button)

## 0.5.1

* Updated node-botvac dependency to 0.1.7

## 0.5.2

* Added schema file for use with homebridge-config-ui-x

## 0.6.0

* Added support for zone cleaning

## 0.6.1

* Fixed homebridge startup failed when robot does not support zone cleaning

## 0.6.2

* Fixed homebridge startup failed when robot does not support mapping

## 0.6.3

* Fixed homebridge crash when robot has a map without zones
* Fixed homebridge crash when homebridge has no internet connection or the neato servers are offline
* Fixed homebridge crash when 2 zones have the same name

## 0.7.0

* Added find me function
* Added spot cleaning function with individual spot size and repeat option
* Added model and firmware information to homekit
* Added logic to be able to change the currently cleaned room
* Improved number of requests when having multiple rooms
* Fixed room switches not taking eco and extraCare mode into account
* Fixed room switches not supporting pause/resume

## 0.7.1
* Fixed robot not shown before setting up a floor plan

## 0.7.2
* Fixed homebridge crash with multiple robots per account

## 0.8.0
* Add German plugin language (for example, this gives you a "Sauge Küche" Siri command for a zone called "Küche")
* Added possibility to toggle between languages (English/German) in Homebridge UI Plugin Settings

## 0.8.1
* Include Robot name in Homekit battery service name

## 0.8.2
* Eliminate warnings on Homebridge >= 1.3.0 (77945f8 and 877c3d7 on `naofireblade/homebridge-neato`)

## 0.8.3
* Add French plugin language (for example, this gives you a "Aspirer la cuisine" Siri command for a zone called "La cuisine")

## 0.8.4
* Link to token getter tool in homebridge UI
