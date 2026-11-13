#pragma once

// Team / project identity used by the provisioning AP and the mDNS host.
#define TEAM_ID          "Forever_Knights"
#define PROJECT_NAME     "Smart Classroom"
#define FW_VERSION       "2.0.0"
#define FW_BUILD         __DATE__ " " __TIME__

// mDNS hostnames cannot contain underscores; config.cpp sanitises TEAM_ID.
#define MDNS_PREFIX      "smartclass-"
