'use strict';

/* FastRobox Smart Classroom dashboard.
 * Single-page app over /api. Session token lives in sessionStorage only
 * (never localStorage, never a URL). Live data arrives over SSE with the
 * token in an Authorization header, so it never appears in server logs. */

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'sc_token';
const LANG_KEY = 'sc_lang';
const ROOM_KEY = 'sc_room';

const state = {
  token: '',
  lang: 'en',
  me: null,
  rooms: [],
  roomIds: [],
  selectedRoomId: null,
  view: 'overview',
  adminTab: 'rooms',
  dashboard: null,
  attendanceRows: [],
  eventRows: [],
  adminLoaded: false,
  adminUsers: [],
  adminRooms: [],
  adminDevices: [],
  adminCards: [],
  adminSchedules: [],
  assignments: [],
  assignRoomId: null,
  settings: {},
  sseRunning: false,
  abort: null,
  refreshTimer: null,
  clockTimer: null,
  refreshSoonTimer: null,
  expiring: false,
};

/* ------------------------------------------------------------------ i18n */

const I18N = {
  en: {
    'brand.subtitle': 'Safety · Access · Attendance',
    'login.subtitle': 'Sign in with your school account.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.foot': 'Accounts are managed by the school administrator.',
    'header.room': 'Room',
    'header.logout': 'Sign out',
    'conn.connecting': 'connecting…',
    'conn.live': 'live',
    'conn.reconnecting': 'reconnecting…',
    'conn.waiting': 'waiting for credentials',
    'conn.rateLimited': 'rate limited',
    'conn.auth': 'stream auth unavailable',
    'conn.unavailable': 'stream unavailable',
    'nav.overview': 'Overview',
    'nav.attendance': 'Attendance',
    'nav.events': 'Event log',
    'nav.admin': 'Administration',
    'nav.myAttendance': 'My attendance',
    'nav.myChildren': 'My children',
    'role.admin': 'admin',
    'role.teacher': 'teacher',
    'role.student': 'student',
    'role.guardian': 'guardian',
    'role.staff': 'staff',
    'overview.title': 'Room overview',
    'card.temperature': 'Temperature',
    'card.threshold': 'threshold',
    'card.humidity': 'Humidity',
    'card.heatIndex': 'Heat index',
    'card.trend': 'trend',
    'card.flame': 'Flame / Fire',
    'card.door': 'Door lock',
    'card.updated': 'updated',
    'card.device': 'Device',
    'card.lastSeen': 'last seen',
    'panel.health': 'Device health',
    'panel.trend': 'Temperature history',
    'panel.controls': 'Controls',
    'panel.recentEvents': 'Recent events',
    'panel.today': 'Today in this room',
    'health.firmware': 'Firmware',
    'health.uptime': 'Uptime',
    'health.rssi': 'Wi‑Fi RSSI',
    'health.heap': 'Free heap',
    'health.chipTemp': 'Chip temperature',
    'health.resetReason': 'Last reset reason',
    'health.noDevice': 'No device is registered for this room yet.',
    'health.offline': 'Device is offline; showing the last known values.',
    'status.SAFE': 'SAFE',
    'status.WARNING': 'WARNING',
    'status.DANGER': 'DANGER',
    'status.FIRE': 'FIRE',
    'status.PANIC': 'PANIC',
    'status.UNKNOWN': 'UNKNOWN',
    'fire.latched': 'Latched — authorized reset required',
    'fire.silenced': 'Latched — buzzer silenced',
    'fire.clear': 'No fire detected',
    'trend.RISING': 'RISING',
    'trend.STABLE': 'STABLE',
    'trend.FALLING': 'FALLING',
    'quality.good': 'good',
    'quality.bad': 'bad',
    'doorState.LOCKED': 'LOCKED',
    'doorState.UNLOCKED': 'UNLOCKED',
    'doorState.UNKNOWN': 'UNKNOWN',
    'source.telemetry': 'reported by telemetry',
    'source.event': 'from event log',
    'source.none': 'no door report yet',
    'door.lock': 'Lock door',
    'door.unlock': 'Unlock door',
    'fire.reset': 'Reset fire',
    'fire.silence': 'Silence buzzer',
    'alert.fireTitle': 'FIRE — {room}: evacuate now',
    'alert.fireDetailFlame': 'Flame is still detected. Door unlocked. Buzzer active.',
    'alert.fireDetailClear': 'Flame is no longer detected. Door stays unlocked until an authorized reset.',
    'alert.panicTitle': 'PANIC — {room}',
    'alert.panicDetail': 'Panic button was pressed. Notify the school office and check the room.',
    'chart.note': 'Last {n} readings · min {min}°C · max {max}°C',
    'chart.empty': 'Not enough readings to draw a chart yet.',
    'attendance.title': 'Attendance',
    'attendance.count': '{n} record(s)',
    'table.name': 'Name',
    'table.role': 'Role',
    'table.uid': 'Card UID',
    'table.status': 'Status',
    'table.date': 'Date',
    'table.time': 'Time',
    'table.type': 'Type',
    'table.detail': 'Detail',
    'table.room': 'Room',
    'table.sequence': 'Seq',
    'table.device': 'Device',
    'table.state': 'State',
    'table.actions': 'Actions',
    'table.email': 'Email',
    'table.owner': 'Owner',
    'table.subject': 'Subject',
    'table.teacher': 'Teacher',
    'table.day': 'Day',
    'table.result': 'Result',
    'table.reason': 'Reason',
    'table.ip': 'IP',
    'table.lastSeen': 'Last seen',
    'events.title': 'Event log',
    'events.filter': 'Type',
    'events.all': 'All types',
    'empty.attendance': 'No attendance records yet.',
    'empty.events': 'No events recorded yet.',
    'empty.eventsRoom': 'No events for this room yet.',
    'empty.taps': 'No card taps today yet.',
    'empty.devices': 'No devices registered yet.',
    'empty.cards': 'No cards registered yet.',
    'empty.schedules': 'No classes scheduled yet.',
    'empty.logins': 'No login attempts recorded yet.',
    'empty.notify': 'No notifications recorded yet.',
    'empty.rooms': 'No rooms yet.',
    'empty.assignments': 'No users are assigned to this room.',
    'student.title': 'My attendance',
    'student.today': 'Today',
    'student.history': 'Recent days',
    'student.notYet': 'Not marked yet',
    'student.markedAt': 'Marked at {time} · room {room}',
    'guardian.title': 'My children',
    'guardian.none': 'No children are linked to this account yet.',
    'guardian.arrival': 'Arrival today',
    'guardian.arrivedAt': 'Arrived at {time}',
    'guardian.notArrived': 'Not arrived yet',
    'guardian.history': 'Recent attendance',
    'guardian.class': 'Class {label}',
    'admin.title': 'Administration',
    'admin.rooms': 'Rooms',
    'admin.devices': 'Devices',
    'admin.users': 'Users',
    'admin.cards': 'Cards',
    'admin.schedules': 'Schedules',
    'admin.settings': 'Settings',
    'admin.logins': 'Login history',
    'admin.notifications': 'Notifications',
    'admin.roomsList': 'Rooms',
    'admin.roomId': 'Room ID',
    'admin.roomName': 'Room name',
    'admin.addRoom': 'Add room',
    'admin.assignments': 'Assignments',
    'admin.room': 'Room',
    'admin.assign': 'Assign',
    'admin.deviceList': 'Registered devices',
    'admin.deviceId': 'Device ID',
    'admin.deviceName': 'Display name',
    'admin.addDevice': 'Register device',
    'admin.tokenHint': 'A device token is shown only once. Paste it into the device provisioning page.',
    'admin.userList': 'Accounts',
    'admin.addUser': 'Add account',
    'admin.classLabel': 'Class label',
    'admin.createUser': 'Create account',
    'admin.cardList': 'RFID cards',
    'admin.addCard': 'Register card',
    'admin.label': 'Label',
    'admin.scheduleList': 'Class schedule',
    'admin.addSchedule': 'Add class',
    'admin.startTime': 'Start (HH:MM)',
    'admin.endTime': 'End (HH:MM)',
    'admin.saveSettings': 'Save settings',
    'admin.provider': 'Notification provider',
    'admin.notifyLog': 'Recent alert deliveries',
    'admin.rotate': 'Rotate token',
    'admin.revoke': 'Revoke',
    'admin.enable': 'Enable',
    'admin.disable': 'Disable',
    'admin.resetPassword': 'Reset password',
    'admin.newPasswordPrompt': 'New password (at least 8 characters) for {name}:',
    'admin.delete': 'Delete',
    'admin.teacherNone': '— none —',
    'admin.ownerNone': '— unassigned —',
    'notify.provider': 'Provider',
    'notify.configured': 'Configured',
    'notify.hint': 'When no provider is configured, alerts are recorded as skipped and are never marked delivered.',
    'notify.sent': 'sent',
    'notify.skipped': 'skipped',
    'notify.failed': 'failed',
    'confirm.delete': 'Delete this record?',
    'confirm.revoke': 'Revoke this device? It will stop authenticating immediately.',
    'confirm.deactivate': 'Disable this account? All its sessions will be closed.',
    'day.1': 'Monday',
    'day.2': 'Tuesday',
    'day.3': 'Wednesday',
    'day.4': 'Thursday',
    'day.5': 'Friday',
    'day.6': 'Saturday',
    'day.7': 'Sunday',
    'att.present': 'present',
    'att.late': 'late',
    'att.absent': 'absent',
    'evt.BOOT': 'Device boot',
    'evt.STATUS': 'Status',
    'evt.FIRE': 'Fire detected',
    'evt.FIRE_CLEARED': 'Fire cleared',
    'evt.SILENCED': 'Alarm silenced',
    'evt.PANIC': 'Panic',
    'evt.CARD_TAP': 'Card tap',
    'evt.ENTRY_GRANTED': 'Entry granted',
    'evt.ENTRY_DENIED': 'Entry denied',
    'evt.SENSOR_ERROR': 'Sensor error',
    'evt.SETTINGS_APPLIED': 'Settings applied',
    'evt.UNKNOWN_CARD': 'Unknown card',
    'evt.DOOR_CHANGE': 'Door change',
    'evt.COMMAND_ACK': 'Command acknowledged',
    'setting.room_id': 'Default room ID',
    'setting.temp_threshold_c': 'Warning temperature (°C)',
    'setting.humidity_threshold_pct': 'Warning humidity (%)',
    'setting.danger_temp_c': 'Danger temperature (°C)',
    'setting.danger_exit_temp_c': 'Danger exit temperature (°C)',
    'setting.warn_exit_temp_c': 'Warning exit temperature (°C)',
    'setting.warn_exit_humidity_pct': 'Warning exit humidity (%)',
    'setting.flame_response_limit_ms': 'Flame response limit (ms)',
    'setting.fire_confirm_ms': 'Fire confirmation (ms)',
    'setting.panic_touch_ms': 'Panic touch hold (ms)',
    'setting.door_auto_lock_ms': 'Door auto-lock (ms)',
    'setting.telemetry_interval_ms': 'Telemetry interval (ms)',
    'setting.command_poll_interval_ms': 'Command poll interval (ms)',
    'setting.student_uids': 'Student card UIDs (comma separated)',
    'setting.teacher_uids': 'Teacher card UIDs (comma separated)',
    'common.online': 'online',
    'common.offline': 'offline',
    'common.active': 'active',
    'common.inactive': 'disabled',
    'common.none': '—',
    'common.close': 'Close',
    'common.yes': 'yes',
    'common.no': 'no',
    'secret.deviceToken': 'Device token',
    'secret.newToken': 'New device token',
    'secret.hint': 'This value is shown once. Store it securely and enter it on the device.',
    'msg.lockQueued': 'Lock command queued.',
    'msg.unlockQueued': 'Unlock command queued.',
    'msg.resetQueued': 'Fire reset recorded.',
    'msg.silenceQueued': 'Buzzer silenced.',
    'msg.settingsSaved': 'Settings saved.',
    'msg.roomAdded': 'Room saved.',
    'msg.assigned': 'Assignment saved.',
    'msg.removed': 'Removed.',
    'msg.userCreated': 'Account created.',
    'msg.userUpdated': 'Account updated.',
    'msg.cardSaved': 'Card saved.',
    'msg.scheduleAdded': 'Class scheduled.',
    'msg.deviceCreated': 'Device registered.',
    'msg.deviceRevoked': 'Device revoked.',
    'msg.tokenRotated': 'Token rotated.',
    'msg.deleted': 'Deleted.',
    'err.load': 'Could not load data',
    'err.action': 'Action failed',
    'err.noRoom': 'No room is assigned to this account yet. Ask an administrator to assign one.',
    'err.session': 'Your session expired. Please sign in again.',
    'err.invalid': 'Invalid credentials or the account is temporarily locked.',
    'err.rateLimited': 'Too many attempts. Wait a few seconds and try again.',
    'err.unavailable': 'Sign-in is not configured on the server yet.',
    'err.network': 'Network error. Check the connection and try again.',
    'footer.team': 'Team Forever_Knights',
    'footer.tz': 'Times shown in Asia/Dhaka',
  },
  bn: {
    'brand.subtitle': 'নিরাপত্তা · প্রবেশ · উপস্থিতি',
    'login.subtitle': 'আপনার স্কুল অ্যাকাউন্ট দিয়ে সাইন ইন করুন।',
    'login.email': 'ইমেইল',
    'login.password': 'পাসওয়ার্ড',
    'login.submit': 'সাইন ইন',
    'login.foot': 'অ্যাকাউন্ট স্কুল প্রশাসক পরিচালনা করেন।',
    'header.room': 'রুম',
    'header.logout': 'সাইন আউট',
    'conn.connecting': 'সংযোগ হচ্ছে…',
    'conn.live': 'লাইভ',
    'conn.reconnecting': 'পুনঃসংযোগ…',
    'conn.waiting': 'শংসাপত্রের অপেক্ষায়',
    'conn.rateLimited': 'অনুরোধের সীমা',
    'conn.auth': 'স্ট্রিম অনুমোদন নেই',
    'conn.unavailable': 'স্ট্রিম অনুপলব্ধ',
    'nav.overview': 'সারসংক্ষেপ',
    'nav.attendance': 'উপস্থিতি',
    'nav.events': 'ইভেন্ট লগ',
    'nav.admin': 'ব্যবস্থাপনা',
    'nav.myAttendance': 'আমার উপস্থিতি',
    'nav.myChildren': 'আমার সন্তান',
    'role.admin': 'অ্যাডমিন',
    'role.teacher': 'শিক্ষক',
    'role.student': 'শিক্ষার্থী',
    'role.guardian': 'অভিভাবক',
    'role.staff': 'স্টাফ',
    'overview.title': 'রুমের সারসংক্ষেপ',
    'card.temperature': 'তাপমাত্রা',
    'card.threshold': 'সীমা',
    'card.humidity': 'আর্দ্রতা',
    'card.heatIndex': 'তাপ সূচক',
    'card.trend': 'প্রবণতা',
    'card.flame': 'আগুন / ফায়ার',
    'card.door': 'দরজার তালা',
    'card.updated': 'হালনাগাদ',
    'card.device': 'ডিভাইস',
    'card.lastSeen': 'সর্বশেষ দেখা',
    'panel.health': 'ডিভাইসের স্বাস্থ্য',
    'panel.trend': 'তাপমাত্রার ইতিহাস',
    'panel.controls': 'নিয়ন্ত্রণ',
    'panel.recentEvents': 'সাম্প্রতিক ইভেন্ট',
    'panel.today': 'আজ এই রুমে',
    'health.firmware': 'ফার্মওয়্যার',
    'health.uptime': 'চালু সময়',
    'health.rssi': 'ওয়াই-ফাই সিগন্যাল',
    'health.heap': 'ফ্রি হিপ',
    'health.chipTemp': 'চিপ তাপমাত্রা',
    'health.resetReason': 'সর্বশেষ রিসেটের কারণ',
    'health.noDevice': 'এই রুমে এখনো কোনো ডিভাইস নিবন্ধিত হয়নি।',
    'health.offline': 'ডিভাইস অফলাইন; সর্বশেষ মান দেখানো হচ্ছে।',
    'status.SAFE': 'নিরাপদ',
    'status.WARNING': 'সতর্কতা',
    'status.DANGER': 'বিপদ',
    'status.FIRE': 'আগুন',
    'status.PANIC': 'প্যানিক',
    'status.UNKNOWN': 'অজানা',
    'fire.latched': 'ল্যাচড — অনুমোদিত রিসেট প্রয়োজন',
    'fire.silenced': 'ল্যাচড — বাজার নীরব',
    'fire.clear': 'আগুন শনাক্ত হয়নি',
    'trend.RISING': 'বাড়ছে',
    'trend.STABLE': 'স্থিতিশীল',
    'trend.FALLING': 'কমছে',
    'quality.good': 'ভালো',
    'quality.bad': 'ত্রুটিপূর্ণ',
    'doorState.LOCKED': 'লক',
    'doorState.UNLOCKED': 'আনলক',
    'doorState.UNKNOWN': 'অজানা',
    'source.telemetry': 'টেলিমেট্রি থেকে',
    'source.event': 'ইভেন্ট লগ থেকে',
    'source.none': 'দরজার কোনো রিপোর্ট নেই',
    'door.lock': 'দরজা লক করুন',
    'door.unlock': 'দরজা খুলুন',
    'fire.reset': 'ফায়ার রিসেট',
    'fire.silence': 'বাজার নীরব করুন',
    'alert.fireTitle': 'আগুন — {room}: এখনই সরিয়ে নিন',
    'alert.fireDetailFlame': 'এখনো আগুন শনাক্ত হচ্ছে। দরজা আনলক। বাজার চালু।',
    'alert.fireDetailClear': 'আগুন আর শনাক্ত হচ্ছে না। অনুমোদিত রিসেট না হওয়া পর্যন্ত দরজা আনলক থাকবে।',
    'alert.panicTitle': 'প্যানিক — {room}',
    'alert.panicDetail': 'প্যানিক বোতাম চাপা হয়েছে। স্কুল অফিসকে জানান এবং রুমটি দেখুন।',
    'chart.note': 'সর্বশেষ {n} রিডিং · সর্বনিম্ন {min}°C · সর্বোচ্চ {max}°C',
    'chart.empty': 'চার্ট আঁকার জন্য পর্যাপ্ত রিডিং নেই।',
    'attendance.title': 'উপস্থিতি',
    'attendance.count': '{n}টি রেকর্ড',
    'table.name': 'নাম',
    'table.role': 'ভূমিকা',
    'table.uid': 'কার্ড UID',
    'table.status': 'অবস্থা',
    'table.date': 'তারিখ',
    'table.time': 'সময়',
    'table.type': 'ধরন',
    'table.detail': 'বিস্তারিত',
    'table.room': 'রুম',
    'table.sequence': 'ক্রম',
    'table.device': 'ডিভাইস',
    'table.state': 'অবস্থা',
    'table.actions': 'কার্যক্রম',
    'table.email': 'ইমেইল',
    'table.owner': 'মালিক',
    'table.subject': 'বিষয়',
    'table.teacher': 'শিক্ষক',
    'table.day': 'দিন',
    'table.result': 'ফলাফল',
    'table.reason': 'কারণ',
    'table.ip': 'আইপি',
    'table.lastSeen': 'সর্বশেষ দেখা',
    'events.title': 'ইভেন্ট লগ',
    'events.filter': 'ধরন',
    'events.all': 'সব ধরন',
    'empty.attendance': 'এখনো কোনো উপস্থিতি নেই।',
    'empty.events': 'এখনো কোনো ইভেন্ট নেই।',
    'empty.eventsRoom': 'এই রুমে এখনো কোনো ইভেন্ট নেই।',
    'empty.taps': 'আজ এখনো কোনো কার্ড ট্যাপ নেই।',
    'empty.devices': 'এখনো কোনো ডিভাইস নিবন্ধিত হয়নি।',
    'empty.cards': 'এখনো কোনো কার্ড নিবন্ধিত হয়নি।',
    'empty.schedules': 'এখনো কোনো ক্লাস নির্ধারিত হয়নি।',
    'empty.logins': 'এখনো কোনো লগইন চেষ্টা নেই।',
    'empty.notify': 'এখনো কোনো নোটিফিকেশন নেই।',
    'empty.rooms': 'এখনো কোনো রুম নেই।',
    'empty.assignments': 'এই রুমে কোনো ব্যবহারকারী নিয়োজিত নেই।',
    'student.title': 'আমার উপস্থিতি',
    'student.today': 'আজ',
    'student.history': 'সাম্প্রতিক দিন',
    'student.notYet': 'এখনো চিহ্নিত হয়নি',
    'student.markedAt': '{time}-এ চিহ্নিত · রুম {room}',
    'guardian.title': 'আমার সন্তান',
    'guardian.none': 'এই অ্যাকাউন্টের সাথে এখনো কোনো সন্তান যুক্ত নেই।',
    'guardian.arrival': 'আজকের আগমন',
    'guardian.arrivedAt': '{time}-এ পৌঁছেছে',
    'guardian.notArrived': 'এখনো পৌঁছায়নি',
    'guardian.history': 'সাম্প্রতিক উপস্থিতি',
    'guardian.class': 'শ্রেণি {label}',
    'admin.title': 'ব্যবস্থাপনা',
    'admin.rooms': 'রুম',
    'admin.devices': 'ডিভাইস',
    'admin.users': 'ব্যবহারকারী',
    'admin.cards': 'কার্ড',
    'admin.schedules': 'সময়সূচি',
    'admin.settings': 'সেটিংস',
    'admin.logins': 'লগইন ইতিহাস',
    'admin.notifications': 'নোটিফিকেশন',
    'admin.roomsList': 'রুম',
    'admin.roomId': 'রুম আইডি',
    'admin.roomName': 'রুমের নাম',
    'admin.addRoom': 'রুম যোগ করুন',
    'admin.assignments': 'নিয়োগ',
    'admin.room': 'রুম',
    'admin.assign': 'নিয়োগ দিন',
    'admin.deviceList': 'নিবন্ধিত ডিভাইস',
    'admin.deviceId': 'ডিভাইস আইডি',
    'admin.deviceName': 'প্রদর্শিত নাম',
    'admin.addDevice': 'ডিভাইস নিবন্ধন',
    'admin.tokenHint': 'ডিভাইস টোকেন একবারই দেখানো হয়। ডিভাইসের প্রভিশনিং পেজে বসান।',
    'admin.userList': 'অ্যাকাউন্ট',
    'admin.addUser': 'অ্যাকাউন্ট যোগ করুন',
    'admin.classLabel': 'শ্রেণি',
    'admin.createUser': 'অ্যাকাউন্ট তৈরি',
    'admin.cardList': 'আরএফআইডি কার্ড',
    'admin.addCard': 'কার্ড নিবন্ধন',
    'admin.label': 'লেবেল',
    'admin.scheduleList': 'ক্লাস সময়সূচি',
    'admin.addSchedule': 'ক্লাস যোগ করুন',
    'admin.startTime': 'শুরু (HH:MM)',
    'admin.endTime': 'শেষ (HH:MM)',
    'admin.saveSettings': 'সেটিংস সংরক্ষণ',
    'admin.provider': 'নোটিফিকেশন প্রোভাইডার',
    'admin.notifyLog': 'সাম্প্রতিক অ্যালার্ট ডেলিভারি',
    'admin.rotate': 'টোকেন বদলান',
    'admin.revoke': 'বাতিল',
    'admin.enable': 'চালু',
    'admin.disable': 'বন্ধ',
    'admin.resetPassword': 'পাসওয়ার্ড রিসেট',
    'admin.newPasswordPrompt': '{name}-এর নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর):',
    'admin.delete': 'মুছুন',
    'admin.teacherNone': '— কেউ না —',
    'admin.ownerNone': '— অনির্ধারিত —',
    'notify.provider': 'প্রোভাইডার',
    'notify.configured': 'কনফিগার করা',
    'notify.hint': 'কোনো প্রোভাইডার কনফিগার না থাকলে অ্যালার্ট “skipped” হিসেবে সংরক্ষিত হয়, কখনো “delivered” দেখানো হয় না।',
    'notify.sent': 'পাঠানো',
    'notify.skipped': 'বাদ',
    'notify.failed': 'ব্যর্থ',
    'confirm.delete': 'এই রেকর্ডটি মুছবেন?',
    'confirm.revoke': 'এই ডিভাইস বাতিল করবেন? এটি সাথে সাথে প্রমাণীকরণ বন্ধ করবে।',
    'confirm.deactivate': 'এই অ্যাকাউন্ট বন্ধ করবেন? এর সব সেশন বন্ধ হবে।',
    'day.1': 'সোমবার',
    'day.2': 'মঙ্গলবার',
    'day.3': 'বুধবার',
    'day.4': 'বৃহস্পতিবার',
    'day.5': 'শুক্রবার',
    'day.6': 'শনিবার',
    'day.7': 'রবিবার',
    'att.present': 'উপস্থিত',
    'att.late': 'বিলম্বিত',
    'att.absent': 'অনুপস্থিত',
    'evt.BOOT': 'ডিভাইস বুট',
    'evt.STATUS': 'অবস্থা',
    'evt.FIRE': 'আগুন শনাক্ত',
    'evt.FIRE_CLEARED': 'আগুন নিভেছে',
    'evt.SILENCED': 'অ্যালার্ম নীরব',
    'evt.PANIC': 'প্যানিক',
    'evt.CARD_TAP': 'কার্ড ট্যাপ',
    'evt.ENTRY_GRANTED': 'প্রবেশ অনুমোদিত',
    'evt.ENTRY_DENIED': 'প্রবেশ প্রত্যাখ্যাত',
    'evt.SENSOR_ERROR': 'সেন্সর ত্রুটি',
    'evt.SETTINGS_APPLIED': 'সেটিংস প্রয়োগ',
    'evt.UNKNOWN_CARD': 'অজানা কার্ড',
    'evt.DOOR_CHANGE': 'দরজার পরিবর্তন',
    'evt.COMMAND_ACK': 'কমান্ড নিশ্চিত',
    'setting.room_id': 'ডিফল্ট রুম আইডি',
    'setting.temp_threshold_c': 'সতর্কতা তাপমাত্রা (°C)',
    'setting.humidity_threshold_pct': 'সতর্কতা আর্দ্রতা (%)',
    'setting.danger_temp_c': 'বিপদ তাপমাত্রা (°C)',
    'setting.danger_exit_temp_c': 'বিপদ থেকে বের হওয়ার তাপমাত্রা (°C)',
    'setting.warn_exit_temp_c': 'সতর্কতা থেকে বের হওয়ার তাপমাত্রা (°C)',
    'setting.warn_exit_humidity_pct': 'সতর্কতা থেকে বের হওয়ার আর্দ্রতা (%)',
    'setting.flame_response_limit_ms': 'আগুন প্রতিক্রিয়া সীমা (ms)',
    'setting.fire_confirm_ms': 'আগুন নিশ্চিতকরণ (ms)',
    'setting.panic_touch_ms': 'প্যানিক স্পর্শ সময় (ms)',
    'setting.door_auto_lock_ms': 'দরজা অটো-লক (ms)',
    'setting.telemetry_interval_ms': 'টেলিমেট্রি বিরতি (ms)',
    'setting.command_poll_interval_ms': 'কমান্ড পোলিং বিরতি (ms)',
    'setting.student_uids': 'শিক্ষার্থী কার্ড UID (কমা দিয়ে)',
    'setting.teacher_uids': 'শিক্ষক কার্ড UID (কমা দিয়ে)',
    'common.online': 'অনলাইন',
    'common.offline': 'অফলাইন',
    'common.active': 'সক্রিয়',
    'common.inactive': 'নিষ্ক্রিয়',
    'common.none': '—',
    'common.close': 'বন্ধ',
    'common.yes': 'হ্যাঁ',
    'common.no': 'না',
    'secret.deviceToken': 'ডিভাইস টোকেন',
    'secret.newToken': 'নতুন ডিভাইস টোকেন',
    'secret.hint': 'এই মান একবারই দেখানো হয়। নিরাপদে রাখুন এবং ডিভাইসে লিখুন।',
    'msg.lockQueued': 'লক কমান্ড সারিবদ্ধ হয়েছে।',
    'msg.unlockQueued': 'আনলক কমান্ড সারিবদ্ধ হয়েছে।',
    'msg.resetQueued': 'ফায়ার রিসেট রেকর্ড হয়েছে।',
    'msg.silenceQueued': 'বাজার নীরব করা হয়েছে।',
    'msg.settingsSaved': 'সেটিংস সংরক্ষিত।',
    'msg.roomAdded': 'রুম সংরক্ষিত।',
    'msg.assigned': 'নিয়োগ সংরক্ষিত।',
    'msg.removed': 'সরানো হয়েছে।',
    'msg.userCreated': 'অ্যাকাউন্ট তৈরি হয়েছে।',
    'msg.userUpdated': 'অ্যাকাউন্ট হালনাগাদ হয়েছে।',
    'msg.cardSaved': 'কার্ড সংরক্ষিত।',
    'msg.scheduleAdded': 'ক্লাস সময়সূচিতে যোগ হয়েছে।',
    'msg.deviceCreated': 'ডিভাইস নিবন্ধিত।',
    'msg.deviceRevoked': 'ডিভাইস বাতিল হয়েছে।',
    'msg.tokenRotated': 'টোকেন বদলানো হয়েছে।',
    'msg.deleted': 'মুছে ফেলা হয়েছে।',
    'err.load': 'ডেটা লোড করা যায়নি',
    'err.action': 'কার্যক্রম ব্যর্থ',
    'err.noRoom': 'এই অ্যাকাউন্টে এখনো কোনো রুম নিয়োজিত নেই। প্রশাসককে বলুন।',
    'err.session': 'আপনার সেশন শেষ হয়েছে। আবার সাইন ইন করুন।',
    'err.invalid': 'ভুল শংসাপত্র অথবা অ্যাকাউন্ট সাময়িকভাবে লক করা।',
    'err.rateLimited': 'অনেকবার চেষ্টা হয়েছে। কয়েক সেকেন্ড পর আবার চেষ্টা করুন।',
    'err.unavailable': 'সার্ভারে সাইন-ইন এখনো কনফিগার করা হয়নি।',
    'err.network': 'নেটওয়ার্ক ত্রুটি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
    'footer.team': 'টিম Forever_Knights',
    'footer.tz': 'সময় এশিয়া/ঢাকা অনুযায়ী',
  },
};

function t(key, vars) {
  const table = I18N[state.lang] || I18N.en;
  const raw = table[key] != null ? table[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] != null ? String(vars[name]) : whole));
}

function locale() {
  return state.lang === 'bn' ? 'bn-BD' : 'en-GB';
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(locale(), { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale(), {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale(), { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: '2-digit' });
}

function fmtNum(value, digits) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return digits == null ? String(n) : n.toFixed(digits);
}

function fmtUptime(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  let s = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function applyI18n() {
  document.documentElement.lang = state.lang === 'bn' ? 'bn' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  });
  $('loginLangBtn').textContent = state.lang === 'bn' ? 'English' : 'বাংলা';
  $('langBtn').textContent = state.lang === 'bn' ? 'English' : 'বাংলা';
  if (state.me) $('userRole').textContent = t('role.' + state.me.role);
  renderEventTypeOptions();
}

function setLang(lang) {
  state.lang = lang === 'bn' ? 'bn' : 'en';
  try { localStorage.setItem(LANG_KEY, state.lang); } catch (_) {}
  applyI18n();
  if (state.dashboard) {
    const d = state.dashboard;
    if (d.role === 'student') renderStudent(d);
    else if (d.role === 'guardian') renderGuardian(d);
    else renderOverview(d);
  }
  if (state.adminLoaded) renderAdminAll();
  renderAttendanceTable(state.attendanceRows);
  renderEventTable(state.eventRows);
}

/* ------------------------------------------------------------ DOM helpers */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setBadge(node, text, cls) {
  node.textContent = text;
  node.className = 'badge ' + (cls || 'neutral');
}

function statusClass(status) {
  switch (status) {
    case 'SAFE': return 'ok';
    case 'WARNING': return 'warn';
    case 'DANGER':
    case 'FIRE': return 'danger';
    case 'PANIC': return 'purple';
    default: return 'neutral';
  }
}

function doorClass(value) {
  if (value === 'UNLOCKED') return 'ok';
  if (value === 'LOCKED') return 'danger';
  return 'neutral';
}

function toast(message, kind) {
  const node = $('toast');
  node.textContent = message;
  node.className = 'toast ' + (kind || '');
  node.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { node.hidden = true; }, 4200);
}

function setLoading(on) {
  $('loadingBar').hidden = !on;
}

function showPageError(message) {
  const node = $('pageError');
  node.textContent = message;
  node.hidden = false;
}

function hidePageError() {
  $('pageError').hidden = true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ API */

async function api(path, opts = {}) {
  const options = { method: opts.method || 'GET', headers: {}, cache: 'no-store' };
  if (state.token) options.headers.Authorization = `Bearer ${state.token}`;
  if (opts.body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    const error = new Error(t('err.network'));
    error.network = true;
    throw error;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = {}; }
  }
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    if (res.status === 401 && !opts.allow401 && state.me) sessionExpired();
    throw error;
  }
  return data;
}

function actionError(err) {
  if (err && err.network) return `${t('err.action')}: ${t('err.network')}`;
  if (err && err.status === 401) return t('err.session');
  if (err && err.status === 429) return t('err.rateLimited');
  return `${t('err.action')}: ${(err && err.message) || 'unknown error'}`;
}

/* --------------------------------------------------------------- session */

function readStore(key) {
  try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
}

function writeStore(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (_) {}
}

function readLocal(key) {
  try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
}

function writeLocal(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (_) {}
}

function showLogin(message) {
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginMsg').textContent = message || '';
  $('loginMsg').className = 'form-msg';
  $('loginPassword').value = '';
  setTimeout(() => { try { $('loginEmail').focus(); } catch (_) {} }, 30);
}

function clearSession() {
  state.token = '';
  state.me = null;
  state.dashboard = null;
  state.adminLoaded = false;
  writeStore(TOKEN_KEY, '');
}

function stopLive() {
  state.sseRunning = false;
  if (state.abort) {
    try { state.abort.abort(); } catch (_) {}
    state.abort = null;
  }
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

function sessionExpired() {
  if (state.expiring) return;
  state.expiring = true;
  stopLive();
  clearSession();
  showLogin(t('err.session'));
  state.expiring = false;
}

async function doLogin(event) {
  event.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const button = $('loginBtn');
  $('loginMsg').textContent = '';
  if (!email || !password) {
    $('loginMsg').textContent = t('login.subtitle');
    return;
  }
  button.disabled = true;
  button.textContent = t('conn.connecting');
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: { email, password }, allow401: true });
    state.token = result.token;
    writeStore(TOKEN_KEY, result.token);
    const me = await api('/api/auth/me', { allow401: true });
    state.me = me.user;
    state.roomIds = me.rooms || [];
    $('loginMsg').textContent = '';
    showApp();
    await loadDashboard();
    connectSSE();
    startRefresh();
  } catch (err) {
    if (err.status === 401) $('loginMsg').textContent = t('err.invalid');
    else if (err.status === 429) $('loginMsg').textContent = t('err.rateLimited');
    else if (err.status === 503) $('loginMsg').textContent = t('err.unavailable');
    else $('loginMsg').textContent = err.message || t('err.network');
  } finally {
    button.disabled = false;
    button.textContent = t('login.submit');
  }
}

async function doLogout() {
  const token = state.token;
  stopLive();
  clearSession();
  if (token) {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch (_) {}
  }
  showLogin('');
}

function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('userName').textContent = state.me.display_name || state.me.email;
  $('userRole').textContent = t('role.' + state.me.role);

  const isManager = state.me.role === 'admin' || state.me.role === 'teacher';
  $('roomPickerWrap').hidden = !isManager;
  $('adminTabBtn').hidden = state.me.role !== 'admin';
  $('studentTabBtn').hidden = state.me.role !== 'student';
  $('guardianTabBtn').hidden = state.me.role !== 'guardian';

  document.querySelectorAll('#mainTabs .tab').forEach((tab) => {
    const view = tab.getAttribute('data-view');
    let show = isManager;
    if (view === 'admin') show = state.me.role === 'admin';
    else if (view === 'student') show = state.me.role === 'student';
    else if (view === 'guardian') show = state.me.role === 'guardian';
    tab.hidden = !show;
  });

  const initial = state.me.role === 'student' ? 'student' : state.me.role === 'guardian' ? 'guardian' : 'overview';
  setView(initial);
}

/* -------------------------------------------------------------- overview */

function syncRoomSelect() {
  const select = $('roomSelect');
  clear(select);
  const rooms = state.rooms || [];
  if (!rooms.length) {
    select.appendChild(new Option(t('common.none'), ''));
    return;
  }
  rooms.forEach((room) => {
    select.appendChild(new Option(`${room.roomId}${room.name && room.name !== room.roomId ? ' — ' + room.name : ''}`, room.roomId));
  });
  if (state.selectedRoomId && rooms.some((r) => r.roomId === state.selectedRoomId)) {
    select.value = state.selectedRoomId;
  } else {
    state.selectedRoomId = rooms[0].roomId;
    select.value = rooms[0].roomId;
  }
}

async function loadDashboard(roomId) {
  if (roomId !== undefined) state.selectedRoomId = roomId;
  setLoading(true);
  try {
    const isManager = state.me.role === 'admin' || state.me.role === 'teacher';
    const query = isManager && state.selectedRoomId
      ? `?roomId=${encodeURIComponent(state.selectedRoomId)}`
      : '';
    const data = await api('/api/dashboard' + query);
    state.dashboard = data;
    hidePageError();
    if (data.role === 'student') {
      renderStudent(data);
    } else if (data.role === 'guardian') {
      renderGuardian(data);
    } else {
      if (data.scope && Array.isArray(data.scope.rooms)) {
        state.rooms = data.scope.rooms;
        state.roomIds = data.scope.rooms.map((r) => r.roomId);
      }
      if (data.scope && data.scope.selectedRoomId) state.selectedRoomId = data.scope.selectedRoomId;
      syncRoomSelect();
      renderOverview(data);
    }
  } catch (err) {
    if (err.status === 403 && state.selectedRoomId) {
      // Cached room is no longer accessible for this account; fall back once.
      state.selectedRoomId = null;
      writeLocal(ROOM_KEY, '');
      setLoading(false);
      return loadDashboard();
    }
    if (err.status !== 401) showPageError(`${t('err.load')}: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

async function refreshDashboard() {
  if (!state.me || !state.token) return;
  try {
    await loadDashboard();
  } catch (_) {}
}

function refreshSoon() {
  clearTimeout(state.refreshSoonTimer);
  state.refreshSoonTimer = setTimeout(() => { refreshDashboard(); }, 300);
}

function startRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshDashboard();
  }, 10000);
}

function renderOverview(data) {
  const settings = data.settings || {};
  state.settings = settings;
  $('tempTh').textContent = settings.temp_threshold_c != null ? fmtNum(settings.temp_threshold_c, 0) : '—';
  $('humTh').textContent = settings.humidity_threshold_pct != null ? fmtNum(settings.humidity_threshold_pct, 0) : '—';

  const snapshot = data.snapshot;
  $('deviceCounts').textContent = data.deviceCounts
    ? `${data.deviceCounts.online} / ${data.deviceCounts.total} ${t('common.online')}`
    : '';

  if (!snapshot) {
    setBadge($('roomStatus'), t('status.UNKNOWN'), 'neutral');
    ['temp', 'hum', 'heatIndex', 'heatTrend', 'devLastSeen'].forEach((id) => { $(id).textContent = '—'; });
    setBadge($('flame'), t('status.UNKNOWN'), 'neutral');
    setBadge($('door'), t('doorState.UNKNOWN'), 'neutral');
    setBadge($('devOnline'), t('common.offline'), 'neutral');
    $('fireLatchText').textContent = '—';
    $('doorAt').textContent = '—';
    $('doorSource').textContent = '';
    $('healthNote').textContent = t('health.noDevice');
    ['hFw', 'hUptime', 'hRssi', 'hHeap', 'hChip', 'hReset'].forEach((id) => { $(id).textContent = '—'; });
    clear($('recentEvents'));
    clear($('recentTaps'));
    renderAlert(null);
    renderChart([]);
    showPageError(t('err.noRoom'));
    $('lockBtn').disabled = true;
    $('unlockBtn').disabled = true;
    $('resetFireBtn2').disabled = true;
    return;
  }

  hidePageError();
  const roomState = snapshot.roomState || {};
  const latest = snapshot.latest || null;
  const status = roomState.status || 'UNKNOWN';
  setBadge($('roomStatus'), t('status.' + status), statusClass(status));
  $('roomStatus').textContent = t('status.' + status);

  $('temp').textContent = latest ? fmtNum(latest.temp_c != null ? latest.temp_c : latest.temperature, 1) : '—';
  $('hum').textContent = latest ? fmtNum(latest.rh != null ? latest.rh : latest.humidity, 0) : '—';
  $('heatIndex').textContent = latest ? fmtNum(latest.heat_index_c, 1) : '—';
  $('heatTrend').textContent = latest && latest.heat_trend ? t('trend.' + latest.heat_trend) : '—';

  const flame = latest ? Boolean(latest.flame) : false;
  const fireLatched = Boolean(roomState.fire_latched);
  setBadge($('flame'), (flame || fireLatched) ? t('status.FIRE') : t('status.SAFE'), (flame || fireLatched) ? 'danger' : 'ok');
  $('flameCard').classList.toggle('alarm', flame || fireLatched);
  if (roomState.fire_latched) {
    $('fireLatchText').textContent = roomState.fire_silenced ? t('fire.silenced') : t('fire.latched');
  } else {
    $('fireLatchText').textContent = t('fire.clear');
  }

  const door = snapshot.door || { state: 'UNKNOWN', source: 'none' };
  const doorState = String(door.state || 'UNKNOWN').toUpperCase();
  setBadge($('door'), t('doorState.' + (['LOCKED', 'UNLOCKED'].includes(doorState) ? doorState : 'UNKNOWN')),
    doorClass(doorState));
  $('doorAt').textContent = door.at ? fmtTime(door.at) : '—';
  $('doorCard').classList.toggle('unlocked', doorState === 'UNLOCKED');
  $('doorSource').textContent = door.source ? t('source.' + door.source) : '';

  const device = snapshot.device;
  if (device) {
    setBadge($('devOnline'), device.online ? t('common.online') : t('common.offline'), device.online ? 'ok' : 'danger');
    $('devLastSeen').textContent = device.last_seen ? fmtDateTime(device.last_seen) : '—';
    $('hFw').textContent = device.fw || device.firmware || '—';
    $('hUptime').textContent = fmtUptime(device.uptime_s);
    $('hRssi').textContent = device.rssi != null ? `${device.rssi} dBm` : '—';
    $('hHeap').textContent = device.heap_kb != null ? `${device.heap_kb} KB` : '—';
    $('hChip').textContent = device.chip_temp_c != null ? `${fmtNum(device.chip_temp_c, 1)} °C` : '—';
    $('hReset').textContent = device.last_reset_reason || '—';
    $('healthNote').textContent = device.online ? '' : t('health.offline');
  } else {
    setBadge($('devOnline'), t('common.offline'), 'neutral');
    $('devLastSeen').textContent = '—';
    ['hFw', 'hUptime', 'hRssi', 'hHeap', 'hChip', 'hReset'].forEach((id) => { $(id).textContent = '—'; });
    $('healthNote').textContent = t('health.noDevice');
  }

  if (latest && latest.quality) {
    $('healthNote').textContent = (device && device.online ? '' : t('health.offline') + ' ')
      + `${t('table.status')}: ${latest.quality === 'good' ? t('quality.good') : t('quality.bad')}`;
  }

  renderAlert(snapshot);
  renderChart(snapshot.history || []);
  renderRecentEvents(snapshot.recentEvents || []);
  renderTodayTaps(snapshot.attendanceToday || []);

  const canControl = ['admin', 'teacher'].includes(state.me.role);
  $('lockBtn').disabled = !canControl;
  $('unlockBtn').disabled = !canControl;
  $('resetFireBtn2').disabled = !canControl || flame || !fireLatched;
}

function renderAlert(snapshot) {
  const banner = $('alertBanner');
  if (!snapshot) {
    banner.hidden = true;
    return;
  }
  const roomState = snapshot.roomState || {};
  const roomId = snapshot.roomId || state.selectedRoomId || '';
  const fire = Boolean(roomState.fire_latched) || roomState.status === 'FIRE';
  const flame = Boolean(snapshot.latest && snapshot.latest.flame);
  const panic = Boolean(roomState.panic_active);

  if (fire) {
    banner.hidden = false;
    banner.className = 'alert-banner';
    $('alertTitle').textContent = t('alert.fireTitle', { room: roomId });
    $('alertDetail').textContent = flame ? t('alert.fireDetailFlame') : t('alert.fireDetailClear');
    $('silenceBtn').hidden = false;
    $('resetFireBtn').hidden = false;
    $('silenceBtn').disabled = flame || Boolean(roomState.fire_silenced);
    $('resetFireBtn').disabled = flame;
    return;
  }
  if (panic) {
    banner.hidden = false;
    banner.className = 'alert-banner panic';
    $('alertTitle').textContent = t('alert.panicTitle', { room: roomId });
    $('alertDetail').textContent = t('alert.panicDetail');
    $('silenceBtn').hidden = true;
    $('resetFireBtn').hidden = true;
    return;
  }
  banner.hidden = true;
}

function renderRecentEvents(events) {
  const list = $('recentEvents');
  clear(list);
  if (!events.length) {
    list.appendChild(el('li', 'empty', t('empty.eventsRoom')));
    return;
  }
  events.forEach((ev) => {
    const li = el('li');
    li.appendChild(el('span', 'tag ' + ev.type, eventLabel(ev.type)));
    li.appendChild(el('span', 'desc', eventSummary(ev)));
    li.appendChild(el('span', 'time', fmtTime(ev.created_at)));
    list.appendChild(li);
  });
}

function renderTodayTaps(rows) {
  const list = $('recentTaps');
  clear(list);
  if (!rows.length) {
    list.appendChild(el('li', 'empty', t('empty.taps')));
    return;
  }
  rows.forEach((row) => {
    const li = el('li');
    li.appendChild(el('span', 'tag ' + (row.role || 'student'), t('att.' + (row.status || 'present'))));
    const name = row.display_name || row.uid || '—';
    li.appendChild(el('span', 'desc', name));
    li.appendChild(el('span', 'time', fmtTime(row.created_at)));
    list.appendChild(li);
  });
}

function eventLabel(type) {
  const key = 'evt.' + type;
  const value = t(key);
  return value === key ? type : value;
}

function eventSummary(ev) {
  if (ev.detail) return ev.detail;
  const p = ev.payload || {};
  if (p.uid) return p.uid;
  if (p.state) return p.state;
  if (p.status) return p.status;
  const keys = Object.keys(p);
  if (!keys.length) return '—';
  return keys.slice(0, 3).map((k) => `${k}=${p[k]}`).join(' · ');
}

function renderChart(history) {
  const svg = $('tempChart');
  const NS = 'http://www.w3.org/2000/svg';
  clear(svg);
  const values = (history || [])
    .map((h) => Number(h.temp_c != null ? h.temp_c : h.temperature))
    .filter((v) => Number.isFinite(v));
  if (values.length < 2) {
    $('chartNote').textContent = t('chart.empty');
    return;
  }
  const W = 320, H = 120, P = 14;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = min === max ? min - 1 : min - 0.5;
  const hi = min === max ? max + 1 : max + 0.5;
  const x = (i) => P + (i * (W - 2 * P)) / (values.length - 1);
  const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);

  for (let i = 0; i <= 3; i += 1) {
    const gy = P + (i * (H - 2 * P)) / 3;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(P));
    line.setAttribute('x2', String(W - P));
    line.setAttribute('y1', String(gy));
    line.setAttribute('y2', String(gy));
    line.setAttribute('stroke', 'rgba(148, 163, 184, 0.18)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }

  const threshold = Number(state.settings.temp_threshold_c);
  if (Number.isFinite(threshold) && threshold > lo && threshold < hi) {
    const ty = y(threshold);
    const tline = document.createElementNS(NS, 'line');
    tline.setAttribute('x1', String(P));
    tline.setAttribute('x2', String(W - P));
    tline.setAttribute('y1', String(ty));
    tline.setAttribute('y2', String(ty));
    tline.setAttribute('stroke', 'rgba(245, 158, 11, 0.65)');
    tline.setAttribute('stroke-dasharray', '5 4');
    tline.setAttribute('stroke-width', '1');
    svg.appendChild(tline);
  }

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const poly = document.createElementNS(NS, 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#38bdf8');
  poly.setAttribute('stroke-width', '2');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  svg.appendChild(poly);

  values.forEach((v, i) => {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(x(i)));
    dot.setAttribute('cy', String(y(v)));
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', '#7dd3fc');
    svg.appendChild(dot);
  });

  $('chartNote').textContent = t('chart.note', {
    n: values.length,
    min: min.toFixed(1),
    max: max.toFixed(1),
  });
}

/* --------------------------------------------------- student / guardian */

function renderStudent(data) {
  const today = data.todayAttendance;
  const node = $('studentToday');
  if (today) {
    node.textContent = t('att.' + (today.status || 'present'));
    $('studentTodayMeta').textContent = t('student.markedAt', {
      time: fmtTime(today.created_at),
      room: today.room_id || '—',
    });
  } else {
    node.textContent = t('student.notYet');
    $('studentTodayMeta').textContent = `${fmtDay(new Date().toISOString())} · ${data.today || ''}`;
  }

  const list = $('studentHistory');
  clear(list);
  const rows = data.history || [];
  $('studentEmpty').hidden = rows.length > 0;
  rows.slice(0, 30).forEach((row) => {
    const li = el('li');
    li.appendChild(el('span', 'tag', t('att.' + (row.status || 'present'))));
    li.appendChild(el('span', 'desc', row.room_id || '—'));
    li.appendChild(el('span', 'time', `${fmtDay(row.created_at)} ${fmtTime(row.created_at)}`));
    list.appendChild(li);
  });
}

function renderGuardian(data) {
  const wrap = $('guardianChildren');
  clear(wrap);
  const children = data.children || [];
  $('guardianEmpty').hidden = children.length > 0;
  children.forEach((entry) => {
    const child = entry.child || {};
    const card = el('section', 'panel child-card');
    card.appendChild(el('h4', null, child.display_name || child.email || '—'));
    if (child.class_label) card.appendChild(el('p', 'hint', t('guardian.class', { label: child.class_label })));
    const today = entry.today;
    card.appendChild(el('p', 'hint', t('guardian.arrival')));
    if (today) {
      card.appendChild(el('div', 'big-state', t('att.' + (today.status || 'present'))));
      card.appendChild(el('p', 'hint', t('guardian.arrivedAt', { time: fmtTime(today.created_at) })));
    } else {
      card.appendChild(el('div', 'big-state', t('guardian.notArrived')));
    }
    card.appendChild(el('p', 'hint', t('guardian.history')));
    const list = el('ul', 'list');
    const history = entry.history || [];
    if (!history.length) {
      list.appendChild(el('li', 'empty', t('empty.attendance')));
    } else {
      history.slice(0, 15).forEach((row) => {
        const li = el('li');
        li.appendChild(el('span', 'tag', t('att.' + (row.status || 'present'))));
        li.appendChild(el('span', 'desc', row.room_id || '—'));
        li.appendChild(el('span', 'time', `${fmtDay(row.created_at)} ${fmtTime(row.created_at)}`));
        list.appendChild(li);
      });
    }
    card.appendChild(list);
    wrap.appendChild(card);
  });
}

/* ------------------------------------------------------------- tables */

async function loadAttendance() {
  if (!state.me || !['admin', 'teacher'].includes(state.me.role)) return;
  try {
    const query = new URLSearchParams({ limit: '100' });
    if (state.selectedRoomId) query.set('roomId', state.selectedRoomId);
    const data = await api('/api/attendance?' + query.toString());
    state.attendanceRows = data.attendance || [];
    renderAttendanceTable(state.attendanceRows);
  } catch (err) {
    if (err.status !== 401) showPageError(`${t('err.load')}: ${err.message}`);
  }
}

function renderAttendanceTable(rows) {
  const body = $('attendanceBody');
  clear(body);
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    [row.display_name || row.uid || '—', t('role.' + (row.role || 'student')), row.uid || '—',
      t('att.' + (row.status || 'present')), fmtDay(row.created_at), fmtTime(row.created_at)]
      .forEach((value) => tr.appendChild(document.createElement('td')).textContent = value);
    body.appendChild(tr);
  });
  $('attendanceEmpty').hidden = rows.length > 0;
  $('attendanceCount').textContent = t('attendance.count', { n: rows.length });
}

const EVENT_TYPES = [
  'BOOT', 'STATUS', 'FIRE', 'FIRE_CLEARED', 'SILENCED', 'PANIC',
  'CARD_TAP', 'ENTRY_GRANTED', 'ENTRY_DENIED', 'UNKNOWN_CARD',
  'SENSOR_ERROR', 'SETTINGS_APPLIED', 'DOOR_CHANGE', 'COMMAND_ACK',
];

function renderEventTypeOptions() {
  const select = $('eventTypeFilter');
  if (!select) return;
  const current = select.value;
  clear(select);
  select.appendChild(new Option(t('events.all'), ''));
  EVENT_TYPES.forEach((type) => {
    select.appendChild(new Option(eventLabel(type), type));
  });
  select.value = current;
}

async function loadEvents() {
  if (!state.me || !['admin', 'teacher'].includes(state.me.role)) return;
  try {
    const query = new URLSearchParams({ limit: '200' });
    if (state.selectedRoomId) query.set('roomId', state.selectedRoomId);
    const type = $('eventTypeFilter').value;
    if (type) query.set('type', type);
    const data = await api('/api/events?' + query.toString());
    state.eventRows = data.events || [];
    renderEventTable(state.eventRows);
  } catch (err) {
    if (err.status !== 401) showPageError(`${t('err.load')}: ${err.message}`);
  }
}

function renderEventTable(rows) {
  const body = $('eventsBody');
  clear(body);
  rows.forEach((ev) => {
    const tr = document.createElement('tr');
    const cells = [];
    const typeCell = document.createElement('td');
    typeCell.appendChild(el('span', 'tag ' + ev.type, eventLabel(ev.type)));
    cells.push(typeCell, textCell(eventSummary(ev)), textCell(ev.room_id || '—'),
      textCell(ev.seq != null ? String(ev.seq) : '—'), textCell(fmtDateTime(ev.created_at)));
    cells.forEach((cell) => tr.appendChild(cell));
    body.appendChild(tr);
  });
  $('eventsEmpty').hidden = rows.length > 0;
}

function textCell(value) {
  const td = document.createElement('td');
  td.textContent = value == null ? '—' : String(value);
  return td;
}

/* ------------------------------------------------------------ live feed */

function setConn(on, textKey) {
  $('connDot').className = 'dot ' + (on ? 'on' : 'off');
  $('connText').textContent = t(textKey);
}

function parseStreamBlock(block) {
  let type = 'message';
  const data = [];
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  });
  if (!data.length) return;
  let payload;
  try { payload = JSON.parse(data.join('\n')); } catch (_) { return; }
  handleStreamEvent(type, payload);
}

function handleStreamEvent(type, message) {
  if (!message) return;
  const data = message.data || {};
  if (type === 'reading') {
    const d = state.dashboard;
    if (d && d.snapshot && data.room_id === d.snapshot.roomId) {
      d.snapshot.latest = Object.assign({}, d.snapshot.latest, data);
      d.snapshot.history = (d.snapshot.history || []).concat([data]).slice(-10);
      if (d.snapshot.device) d.snapshot.device.online = true;
      renderOverview(d);
    }
    if (data.status === 'FIRE') refreshSoon();
    return;
  }
  if (type === 'event') {
    const d = state.dashboard;
    if (d && d.snapshot && data.room_id === d.snapshot.roomId) {
      d.snapshot.recentEvents = [data].concat(d.snapshot.recentEvents || []).slice(0, 25);
      renderRecentEvents(d.snapshot.recentEvents);
    }
    if (['BOOT', 'FIRE', 'FIRE_CLEARED', 'SILENCED', 'PANIC', 'SENSOR_ERROR'].includes(data.type)) refreshSoon();
    return;
  }
  if (type === 'attendance') {
    refreshSoon();
    return;
  }
  if (type === 'door') {
    const d = state.dashboard;
    if (d && d.snapshot && data.roomId === d.snapshot.roomId) {
      d.snapshot.door = { state: data.state, at: data.at, source: 'telemetry' };
      renderOverview(d);
    }
    return;
  }
  if (type === 'state') {
    refreshSoon();
    return;
  }
  if (type === 'settings') {
    const d = state.dashboard;
    if (d && d.settings) {
      d.settings.temp_threshold_c = data.temp_threshold_c;
      d.settings.humidity_threshold_pct = data.humidity_threshold_pct;
    }
    return;
  }
  if (type === 'command') {
    toast(`#${data.id} ${data.type} (${data.status})`);
  }
}

async function connectSSE() {
  if (state.sseRunning || !state.token) return;
  state.sseRunning = true;
  while (state.sseRunning && state.token) {
    const ctrl = new AbortController();
    state.abort = ctrl;
    try {
      const res = await fetch('/api/stream', {
        headers: { Authorization: `Bearer ${state.token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      if (res.status === 429) {
        const wait = (Number(res.headers.get('Retry-After')) || 5) * 1000;
        setConn(false, 'conn.rateLimited');
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        setConn(false, res.status === 503 ? 'conn.auth' : 'conn.unavailable');
        await sleep(5000);
        continue;
      }
      setConn(true, 'conn.live');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match;
        while ((match = buffer.match(/\r?\n\r?\n/))) {
          parseStreamBlock(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
      }
      setConn(false, 'conn.reconnecting');
    } catch (_) {
      if (ctrl.signal.aborted) return;
      setConn(false, 'conn.reconnecting');
    }
    await sleep(3000);
  }
}

/* --------------------------------------------------------- fire / door */

async function doorAction(action) {
  if (!state.selectedRoomId) return;
  $('cmdMsg').textContent = t('conn.connecting');
  try {
    await api('/api/door', { method: 'POST', body: { action, roomId: state.selectedRoomId } });
    $('cmdMsg').textContent = action === 'lock' ? t('msg.lockQueued') : t('msg.unlockQueued');
    toast($('cmdMsg').textContent, 'ok');
    refreshSoon();
  } catch (err) {
    $('cmdMsg').textContent = actionError(err);
    toast($('cmdMsg').textContent, 'err');
  }
}

async function fireAction(kind) {
  if (!state.selectedRoomId) return;
  try {
    await api(`/api/fire/${kind}`, { method: 'POST', body: { roomId: state.selectedRoomId } });
    toast(kind === 'reset' ? t('msg.resetQueued') : t('msg.silenceQueued'), 'ok');
    refreshSoon();
  } catch (err) {
    toast(actionError(err), 'err');
  }
}

/* -------------------------------------------------------------- admin */

const SETTINGS_FIELDS = [
  ['room_id', 'text'],
  ['temp_threshold_c', 'number', 0, 50, 0.1],
  ['humidity_threshold_pct', 'number', 0, 100, 1],
  ['danger_temp_c', 'number', 0, 60, 0.1],
  ['danger_exit_temp_c', 'number', 0, 60, 0.1],
  ['warn_exit_temp_c', 'number', 0, 60, 0.1],
  ['warn_exit_humidity_pct', 'number', 0, 100, 1],
  ['flame_response_limit_ms', 'number', 1, 600000, 100],
  ['fire_confirm_ms', 'number', 1, 600000, 100],
  ['panic_touch_ms', 'number', 1, 600000, 100],
  ['door_auto_lock_ms', 'number', 1, 3600000, 100],
  ['telemetry_interval_ms', 'number', 1000, 3600000, 500],
  ['command_poll_interval_ms', 'number', 250, 3600000, 250],
  ['student_uids', 'text'],
  ['teacher_uids', 'text'],
];

async function ensureAdmin() {
  if (state.adminLoaded) return;
  await loadAdmin();
}

async function loadAdmin() {
  setLoading(true);
  const results = await Promise.allSettled([
    api('/api/admin/users'),
    api('/api/admin/rooms'),
    api('/api/devices'),
    api('/api/admin/cards'),
    api('/api/admin/schedules'),
    api('/api/admin/notifications?limit=50'),
    api('/api/admin/login-history?limit=100'),
    api('/api/settings'),
  ]);
  const [users, rooms, devices, cards, schedules, notifications, logins, settings] = results;

  if (users.status === 'fulfilled') state.adminUsers = users.value.users || [];
  if (rooms.status === 'fulfilled') state.adminRooms = rooms.value.rooms || [];
  if (devices.status === 'fulfilled') state.adminDevices = devices.value.devices || [];
  if (cards.status === 'fulfilled') state.adminCards = cards.value.cards || [];
  if (schedules.status === 'fulfilled') state.adminSchedules = schedules.value.schedules || [];
  state.adminNotifications = notifications.status === 'fulfilled' ? notifications.value : null;
  state.adminLogins = logins.status === 'fulfilled' ? (logins.value.history || []) : [];
  state.settings = settings.status === 'fulfilled' ? (settings.value.settings || {}) : state.settings;

  const failed = results.find((r) => r.status === 'rejected' && r.reason && r.reason.status !== 401);
  if (failed) showPageError(`${t('err.load')}: ${failed.reason.message}`);

  state.adminLoaded = true;
  renderAdminAll();
  setLoading(false);
}

function renderAdminAll() {
  renderAdminRooms();
  renderAdminDevices();
  renderAdminUsers();
  renderAdminCards();
  renderAdminSchedules();
  renderAdminSettings();
  renderAdminLogins();
  renderAdminNotifications();
}

function renderAdminRooms() {
  const list = $('adminRoomList');
  clear(list);
  if (!state.adminRooms.length) {
    list.appendChild(el('li', 'empty', t('empty.rooms')));
  } else {
    state.adminRooms.forEach((room) => {
      const li = el('li');
      li.appendChild(el('span', 'tag', room.room_id));
      li.appendChild(el('span', 'desc', room.name || room.room_id));
      li.appendChild(el('span', 'time', String(room.device_count != null ? room.device_count : 0)));
      list.appendChild(li);
    });
  }

  const assignSelect = $('assignRoomSelect');
  const previous = state.assignRoomId || assignSelect.value;
  clear(assignSelect);
  state.adminRooms.forEach((room) => assignSelect.appendChild(new Option(room.room_id, room.room_id)));
  if (state.adminRooms.length) {
    const pick = state.adminRooms.some((r) => r.room_id === previous) ? previous : state.adminRooms[0].room_id;
    assignSelect.value = pick;
    state.assignRoomId = pick;
    loadAssignments(pick);
  } else {
    state.assignRoomId = null;
    clear($('assignmentList'));
  }

  const userSelect = $('assignUserSelect');
  clear(userSelect);
  const assignable = state.adminUsers.filter((u) => u.active !== false && u.role !== 'admin');
  assignable.forEach((u) => userSelect.appendChild(new Option(`${u.display_name} (${t('role.' + u.role)})`, String(u.id))));
}

async function loadAssignments(roomId) {
  if (!roomId) return;
  try {
    const data = await api(`/api/admin/rooms/${encodeURIComponent(roomId)}/assignments`);
    state.assignments = data.assignments || [];
    renderAssignments();
  } catch (err) {
    if (err.status !== 401) toast(actionError(err), 'err');
  }
}

function renderAssignments() {
  const list = $('assignmentList');
  clear(list);
  if (!state.assignments.length) {
    list.appendChild(el('li', 'empty', t('empty.assignments')));
    return;
  }
  state.assignments.forEach((entry) => {
    const li = el('li');
    li.appendChild(el('span', 'tag', t('role.' + entry.role)));
    li.appendChild(el('span', 'desc', entry.display_name || entry.email));
    const remove = el('button', 'btn danger small', t('admin.delete'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/admin/rooms/${encodeURIComponent(entry.room_id)}/assignments/${entry.user_id}`, { method: 'DELETE' });
        toast(t('msg.removed'), 'ok');
        loadAssignments(entry.room_id);
      } catch (err) { toast(actionError(err), 'err'); }
    });
    li.appendChild(remove);
    list.appendChild(li);
  });
}

function renderAdminDevices() {
  const body = $('adminDeviceBody');
  clear(body);
  if (!state.adminDevices.length) {
    const tr = document.createElement('tr');
    const td = textCell(t('empty.devices'));
    td.colSpan = 6;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  state.adminDevices.forEach((device) => {
    const tr = document.createElement('tr');
    tr.appendChild(textCell(device.device_id));
    tr.appendChild(textCell(device.room_id));
    const stateCell = document.createElement('td');
    if (device.revoked_at) {
      stateCell.appendChild(el('span', 'badge danger', t('admin.revoke')));
    } else {
      stateCell.appendChild(el('span', 'badge ' + (device.online ? 'ok' : 'neutral'),
        device.online ? t('common.online') : t('common.offline')));
    }
    tr.appendChild(stateCell);
    tr.appendChild(textCell(device.firmware || '—'));
    tr.appendChild(textCell(device.last_seen ? fmtDateTime(device.last_seen) : '—'));

    const actions = document.createElement('td');
    const wrap = el('div', 'row-actions');
    const rotate = el('button', 'btn small', t('admin.rotate'));
    rotate.type = 'button';
    rotate.disabled = Boolean(device.revoked_at);
    rotate.addEventListener('click', async () => {
      try {
        const result = await api(`/api/devices/${encodeURIComponent(device.device_id)}/token`, { method: 'POST' });
        toast(t('msg.tokenRotated'), 'ok');
        showSecret(t('secret.newToken'), result.token);
        loadAdmin();
      } catch (err) { toast(actionError(err), 'err'); }
    });
    const revoke = el('button', 'btn danger small', t('admin.revoke'));
    revoke.type = 'button';
    revoke.disabled = Boolean(device.revoked_at);
    revoke.addEventListener('click', async () => {
      if (!confirm(t('confirm.revoke'))) return;
      try {
        await api(`/api/devices/${encodeURIComponent(device.device_id)}/revoke`, { method: 'POST' });
        toast(t('msg.deviceRevoked'), 'ok');
        loadAdmin();
      } catch (err) { toast(actionError(err), 'err'); }
    });
    wrap.append(rotate, revoke);
    actions.appendChild(wrap);
    tr.appendChild(actions);
    body.appendChild(tr);
  });
}

function renderAdminUsers() {
  const body = $('adminUserBody');
  clear(body);
  state.adminUsers.forEach((user) => {
    const tr = document.createElement('tr');
    tr.appendChild(textCell(user.display_name || '—'));
    tr.appendChild(textCell(user.email));
    tr.appendChild(textCell(t('role.' + user.role)));
    const stateCell = document.createElement('td');
    stateCell.appendChild(el('span', 'badge ' + (user.active !== false ? 'ok' : 'neutral'),
      user.active !== false ? t('common.active') : t('common.inactive')));
    tr.appendChild(stateCell);

    const actions = document.createElement('td');
    const wrap = el('div', 'row-actions');
    const toggle = el('button', 'btn small', user.active !== false ? t('admin.disable') : t('admin.enable'));
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      if (user.active !== false && !confirm(t('confirm.deactivate'))) return;
      try {
        await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { active: user.active === false } });
        toast(t('msg.userUpdated'), 'ok');
        loadAdmin();
      } catch (err) { toast(actionError(err), 'err'); }
    });
    const reset = el('button', 'btn small', t('admin.resetPassword'));
    reset.type = 'button';
    reset.addEventListener('click', async () => {
      const password = prompt(t('admin.newPasswordPrompt', { name: user.display_name || user.email }));
      if (!password) return;
      try {
        await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { password } });
        toast(t('msg.userUpdated'), 'ok');
      } catch (err) { toast(actionError(err), 'err'); }
    });
    wrap.append(toggle, reset);
    actions.appendChild(wrap);
    tr.appendChild(actions);
    body.appendChild(tr);
  });
}

function renderAdminCards() {
  const body = $('adminCardBody');
  clear(body);
  if (!state.adminCards.length) {
    const tr = document.createElement('tr');
    const td = textCell(t('empty.cards'));
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    state.adminCards.forEach((card) => {
      const tr = document.createElement('tr');
      tr.appendChild(textCell(card.uid));
      tr.appendChild(textCell(t('role.' + (card.role || 'student'))));
      tr.appendChild(textCell(card.display_name || t('admin.ownerNone')));
      const stateCell = document.createElement('td');
      stateCell.appendChild(el('span', 'badge ' + (card.active ? 'ok' : 'neutral'),
        card.active ? t('common.active') : t('common.inactive')));
      tr.appendChild(stateCell);
      const actions = document.createElement('td');
      const del = el('button', 'btn danger small', t('admin.delete'));
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(t('confirm.delete'))) return;
        try {
          await api(`/api/admin/cards/${encodeURIComponent(card.uid)}`, { method: 'DELETE' });
          toast(t('msg.deleted'), 'ok');
          loadAdmin();
        } catch (err) { toast(actionError(err), 'err'); }
      });
      actions.appendChild(del);
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }

  const owner = $('cardOwnerSelect');
  clear(owner);
  owner.appendChild(new Option(t('admin.ownerNone'), ''));
  state.adminUsers.forEach((user) => {
    owner.appendChild(new Option(`${user.display_name} (${t('role.' + user.role)})`, String(user.id)));
  });
}

function renderAdminSchedules() {
  const body = $('adminScheduleBody');
  clear(body);
  if (!state.adminSchedules.length) {
    const tr = document.createElement('tr');
    const td = textCell(t('empty.schedules'));
    td.colSpan = 6;
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    state.adminSchedules.forEach((item) => {
      const tr = document.createElement('tr');
      tr.appendChild(textCell(t('day.' + item.day_of_week)));
      tr.appendChild(textCell(`${item.start_time}–${item.end_time}`));
      tr.appendChild(textCell(item.room_id));
      tr.appendChild(textCell(item.subject || '—'));
      tr.appendChild(textCell(item.teacher_name || t('admin.teacherNone')));
      const actions = document.createElement('td');
      const del = el('button', 'btn danger small', t('admin.delete'));
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(t('confirm.delete'))) return;
        try {
          await api(`/api/admin/schedules/${item.id}`, { method: 'DELETE' });
          toast(t('msg.deleted'), 'ok');
          loadAdmin();
        } catch (err) { toast(actionError(err), 'err'); }
      });
      actions.appendChild(del);
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }

  const roomSelect = $('scheduleRoomSelect');
  clear(roomSelect);
  state.adminRooms.forEach((room) => roomSelect.appendChild(new Option(room.room_id, room.room_id)));

  const teacherSelect = $('scheduleTeacherSelect');
  clear(teacherSelect);
  teacherSelect.appendChild(new Option(t('admin.teacherNone'), ''));
  state.adminUsers.filter((u) => u.role === 'teacher').forEach((user) => {
    teacherSelect.appendChild(new Option(user.display_name, String(user.id)));
  });
}

function renderAdminSettings() {
  const form = $('settingsForm');
  clear(form);
  SETTINGS_FIELDS.forEach(([key, type, min, max, step]) => {
    const label = document.createElement('label');
    label.appendChild(el('span', null, t('setting.' + key)));
    const input = document.createElement('input');
    input.name = key;
    input.type = type;
    if (type === 'number') {
      if (min != null) input.min = String(min);
      if (max != null) input.max = String(max);
      if (step != null) input.step = String(step);
    }
    const value = state.settings[key];
    input.value = value == null ? '' : String(value);
    label.appendChild(input);
    form.appendChild(label);
  });
}

function renderAdminLogins() {
  const body = $('adminLoginBody');
  clear(body);
  if (!state.adminLogins.length) {
    const tr = document.createElement('tr');
    const td = textCell(t('empty.logins'));
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  state.adminLogins.forEach((row) => {
    const tr = document.createElement('tr');
    tr.appendChild(textCell(row.email || row.display_name || '—'));
    const result = document.createElement('td');
    result.appendChild(el('span', 'badge ' + (row.success ? 'ok' : 'danger'),
      row.success ? t('common.yes') : t('common.no')));
    tr.appendChild(result);
    tr.appendChild(textCell(row.reason || '—'));
    tr.appendChild(textCell(row.ip || '—'));
    tr.appendChild(textCell(fmtDateTime(row.created_at)));
    body.appendChild(tr);
  });
}

function renderAdminNotifications() {
  const info = (state.adminNotifications && state.adminNotifications.provider) || {};
  $('notifyProvider').textContent = info.provider || '—';
  $('notifyConfigured').textContent = info.configured ? t('common.yes') : t('common.no');
  const list = $('notifyLog');
  clear(list);
  const rows = (state.adminNotifications && state.adminNotifications.notifications) || [];
  if (!rows.length) {
    list.appendChild(el('li', 'empty', t('empty.notify')));
    return;
  }
  rows.forEach((row) => {
    const li = el('li');
    const cls = row.status === 'sent' ? 'ok' : row.status === 'failed' ? 'danger' : 'warn';
    li.appendChild(el('span', 'tag ' + row.event_type, row.event_type));
    li.appendChild(el('span', 'desc', `${t('notify.' + row.status)} · ${row.provider} · ${row.room_id || '—'}`));
    li.appendChild(el('span', 'time', fmtDateTime(row.created_at)));
    list.appendChild(li);
  });
}

function showSecret(title, value) {
  $('secretTitle').textContent = title;
  $('secretValue').value = value || '';
  const dialog = $('secretDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'open');
  setTimeout(() => { try { $('secretValue').select(); } catch (_) {} }, 50);
}

async function saveSettings() {
  const form = $('settingsForm');
  const body = {};
  SETTINGS_FIELDS.forEach(([key, type]) => {
    const input = form.elements[key];
    if (!input) return;
    if (type === 'number') {
      const n = Number(input.value);
      if (Number.isFinite(n)) body[key] = n;
    } else {
      body[key] = input.value;
    }
  });
  $('settingsMsg').textContent = t('conn.connecting');
  try {
    const data = await api('/api/settings', { method: 'PUT', body });
    state.settings = data.settings || state.settings;
    if (state.dashboard) state.dashboard.settings = state.settings;
    $('settingsMsg').textContent = t('msg.settingsSaved');
    toast(t('msg.settingsSaved'), 'ok');
    renderAdminSettings();
    refreshSoon();
  } catch (err) {
    $('settingsMsg').textContent = actionError(err);
    toast($('settingsMsg').textContent, 'err');
  }
}

/* ------------------------------------------------------------ navigation */

function setView(view) {
  state.view = view;
  document.querySelectorAll('#mainTabs .tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === view);
  });
  ['overview', 'attendance', 'events', 'admin', 'student', 'guardian'].forEach((name) => {
    const section = $('view-' + name);
    if (section) section.hidden = name !== view;
  });
  if (view === 'attendance') loadAttendance();
  if (view === 'events') loadEvents();
  if (view === 'admin') ensureAdmin();
  if ((view === 'student' || view === 'guardian') && state.dashboard) {
    if (state.me.role === 'student') renderStudent(state.dashboard);
    else if (state.me.role === 'guardian') renderGuardian(state.dashboard);
  }
}

function switchAdminTab(name) {
  state.adminTab = name;
  document.querySelectorAll('#adminSubtabs .subtab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-admin') === name);
  });
  ['rooms', 'devices', 'users', 'cards', 'schedules', 'settings', 'logins', 'notifications'].forEach((key) => {
    const pane = $('admin-' + key);
    if (pane) pane.hidden = key !== name;
  });
}

/* --------------------------------------------------------------- events */

function bindStatic() {
  $('loginForm').addEventListener('submit', doLogin);
  $('loginLangBtn').addEventListener('click', () => setLang(state.lang === 'en' ? 'bn' : 'en'));
  $('langBtn').addEventListener('click', () => setLang(state.lang === 'en' ? 'bn' : 'en'));
  $('logoutBtn').addEventListener('click', doLogout);

  $('mainTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) setView(button.getAttribute('data-view'));
  });
  $('adminSubtabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-admin]');
    if (button) switchAdminTab(button.getAttribute('data-admin'));
  });

  $('roomSelect').addEventListener('change', () => {
    state.selectedRoomId = $('roomSelect').value || null;
    writeLocal(ROOM_KEY, state.selectedRoomId);
    loadDashboard(state.selectedRoomId);
    if (state.view === 'attendance') loadAttendance();
    if (state.view === 'events') loadEvents();
  });

  $('eventTypeFilter').addEventListener('change', loadEvents);
  $('lockBtn').addEventListener('click', () => doorAction('lock'));
  $('unlockBtn').addEventListener('click', () => doorAction('unlock'));
  $('resetFireBtn').addEventListener('click', () => fireAction('reset'));
  $('resetFireBtn2').addEventListener('click', () => fireAction('reset'));
  $('silenceBtn').addEventListener('click', () => fireAction('silence'));

  $('assignRoomSelect').addEventListener('change', () => {
    state.assignRoomId = $('assignRoomSelect').value;
    loadAssignments(state.assignRoomId);
  });

  $('roomForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      await api('/api/admin/rooms', {
        method: 'POST',
        body: { roomId: form.elements.roomId.value.trim(), name: form.elements.name.value.trim() },
      });
      form.reset();
      toast(t('msg.roomAdded'), 'ok');
      await loadAdmin();
      refreshDashboard();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('assignmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const roomId = $('assignRoomSelect').value;
    if (!roomId) return;
    try {
      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}/assignments`, {
        method: 'POST',
        body: { userId: Number($('assignUserSelect').value), role: $('assignRoleSelect').value },
      });
      toast(t('msg.assigned'), 'ok');
      loadAssignments(roomId);
      loadDashboard();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('deviceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const result = await api('/api/devices', {
        method: 'POST',
        body: {
          deviceId: form.elements.deviceId.value.trim(),
          roomId: form.elements.roomId.value.trim(),
          name: form.elements.name.value.trim(),
        },
      });
      form.reset();
      toast(t('msg.deviceCreated'), 'ok');
      showSecret(t('secret.deviceToken'), result.token);
      loadAdmin();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('userForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          displayName: form.elements.displayName.value.trim(),
          email: form.elements.email.value.trim(),
          password: form.elements.password.value,
          role: form.elements.role.value,
          classLabel: form.elements.classLabel.value.trim(),
        },
      });
      form.reset();
      toast(t('msg.userCreated'), 'ok');
      loadAdmin();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('cardForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const userId = form.elements.userId.value;
    try {
      await api('/api/admin/cards', {
        method: 'POST',
        body: {
          uid: form.elements.uid.value.trim(),
          role: form.elements.role.value,
          userId: userId ? Number(userId) : null,
          label: form.elements.label.value.trim(),
        },
      });
      form.reset();
      toast(t('msg.cardSaved'), 'ok');
      loadAdmin();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('scheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const teacherId = form.elements.teacherId.value;
    try {
      await api('/api/admin/schedules', {
        method: 'POST',
        body: {
          roomId: form.elements.roomId.value,
          teacherId: teacherId ? Number(teacherId) : null,
          subject: form.elements.subject.value.trim(),
          dayOfWeek: Number(form.elements.dayOfWeek.value),
          startTime: form.elements.startTime.value,
          endTime: form.elements.endTime.value,
        },
      });
      form.reset();
      toast(t('msg.scheduleAdded'), 'ok');
      loadAdmin();
    } catch (err) { toast(actionError(err), 'err'); }
  });

  $('settingsSave').addEventListener('click', saveSettings);
  $('secretClose').addEventListener('click', () => {
    const dialog = $('secretDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    $('secretValue').value = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.me) refreshDashboard();
  });
}

function startClock() {
  const update = () => {
    $('clock').textContent = new Date().toLocaleTimeString(locale(), {
      timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };
  update();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(update, 1000);
}

async function boot() {
  state.lang = readLocal(LANG_KEY) === 'bn' ? 'bn' : 'en';
  state.selectedRoomId = readLocal(ROOM_KEY) || null;
  state.token = readStore(TOKEN_KEY);
  bindStatic();
  applyI18n();
  startClock();

  if (!state.token) {
    showLogin('');
    return;
  }
  try {
    const me = await api('/api/auth/me', { allow401: true });
    state.me = me.user;
    state.roomIds = me.rooms || [];
    writeStore(TOKEN_KEY, state.token);
    showApp();
    await loadDashboard();
    connectSSE();
    startRefresh();
  } catch (_) {
    clearSession();
    showLogin('');
  }
}

document.addEventListener('DOMContentLoaded', boot);
