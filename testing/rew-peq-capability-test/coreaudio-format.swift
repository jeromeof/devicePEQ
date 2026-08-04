// Prints the CURRENT physical stream format of every Core Audio device as JSON.
//
// Exists because REW opens its replay/capture lines through Java (javax.sound),
// which asks Core Audio for one specific format — e.g. "PCM_SIGNED 48000.0 Hz,
// 24 bit, stereo, 6 bytes/frame". If the device is set to something else in
// Audio MIDI Setup (16 bit is the common one), Java can't open the line and REW
// throws a MODAL "Unable to access the replay device" dialog. A modal blocks the
// whole run and can't be cleared over REW's HTTP API, so this has to be caught
// BEFORE a sweep starts, not handled after it fails.
//
// system_profiler SPAudioDataType reports the sample rate but NOT the bit depth,
// so it can't see the failure mode we actually care about — hence dropping to
// the Core Audio API for kAudioStreamPropertyPhysicalFormat.
//
// Run: swift coreaudio-format.swift   (interpreted; no build step needed)
import CoreAudio
import Foundation

func allDeviceIDs() -> [AudioObjectID] {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(
    AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

func deviceName(_ id: AudioObjectID) -> String {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioObjectPropertyName,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var name: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &name) == noErr else { return "" }
  return (name?.takeRetainedValue() as String?) ?? ""
}

// nil when the device has no stream in this scope (e.g. output scope on a mic).
func physicalFormat(_ id: AudioObjectID, scope: AudioObjectPropertyScope) -> [String: Any]? {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioStreamPropertyPhysicalFormat,
    mScope: scope,
    mElement: kAudioObjectPropertyElementMain)
  var f = AudioStreamBasicDescription()
  var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &f) == noErr else { return nil }
  return [
    "sampleRate": f.mSampleRate,
    "bitsPerChannel": f.mBitsPerChannel,
    "channels": f.mChannelsPerFrame,
    "bytesPerFrame": f.mBytesPerFrame,
  ]
}

// REW's device list includes the aliases "Default Device" / "Default Audio
// Device", which are selections rather than device names and match nothing in
// Core Audio — so the defaults have to be resolvable to compare formats.
func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID {
  var addr = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var id = AudioObjectID(0)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  return id
}

let defaultOut = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
let defaultIn = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)

var devices: [[String: Any]] = []
for id in allDeviceIDs() {
  let out = physicalFormat(id, scope: kAudioObjectPropertyScopeOutput)
  let inp = physicalFormat(id, scope: kAudioObjectPropertyScopeInput)
  if out == nil && inp == nil { continue }
  var entry: [String: Any] = [
    "name": deviceName(id),
    "isDefaultOutput": id == defaultOut && out != nil,
    "isDefaultInput": id == defaultIn && inp != nil,
  ]
  if let out { entry["output"] = out }
  if let inp { entry["input"] = inp }
  devices.append(entry)
}

let json = try! JSONSerialization.data(withJSONObject: devices, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
