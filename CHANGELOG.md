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