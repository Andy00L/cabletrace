import type { CableCase } from "@/lib/cases/case-file";

// The Minlianyu 60138 trawl snag, 7 October 2025, off Dongyin in the Matsu Islands. Sources, quotes and conversions:
// plan/research/cases/minlianyu-60138-2025.md (source ids below keep that file's numbering). Taiwan uses CST (UTC+8)
// all year; every time here is UTC. The court publishes the fault's coordinates; the trawler's own positions are
// in the case file (Coast Guard track charts) but not published, so they are placed from the court's descriptions.

const FAULT_PLACE_CITATION = {
  sourceId: 1,
  quote: "受損故障地點為淡水沙崙機房距離180.6公里處，即東引機房北方外海約4.2浬處（座標為北緯26.39910度、東經120.57971度），障礙點係依照光纖設備打出之訊號回映時間推算",
  translation:
    "the fault lies 180.6 km from the Shalun station in Tamsui, that is about 4.2 nautical miles north of the Dongyin station (coordinates 26.39910 N, 120.57971 E); the fault point is worked out from the return time of the signal sent by the fibre equipment",
};
const FAULT_TIME_CITATION = {
  sourceId: 1,
  quote: "於民國114年10月7日21時52分許，在東引機房北方外海約4.2浬（座標為北緯26.39910度、東經120.57971度）",
  translation: "at about 21:52 on 7 October 2025, about 4.2 nautical miles north of the Dongyin station (coordinates 26.39910 N, 120.57971 E)",
};
const HOVER_CITATION = {
  sourceId: 1,
  quote:
    "「閩連漁60138」號漁船於114年10月7日晚間向南航行，於當日21時39分許在海纜處徘徊，同日22時1分許海纜損壞，「閩連漁60138」號漁船距離中華電信公司通報海纜損壞位置約0.06浬，且當時該處附近均無其他船舶之事實。",
  translation:
    "That on the evening of 7 October 2025 the Minlianyu 60138 sailed south, lingered over the cable from about 21:39, the cable was damaged at about 22:01, the trawler was about 0.06 nautical miles from the damage position Chunghwa Telecom reported, and no other ship was nearby at the time.",
};
const SNAG_CITATION = {
  sourceId: 1,
  quote:
    "發現肇事船隻跨過海纜後，於同日21時40分許疑似進行漁撈底拖作業速度降低，同日21時52分許發現傳輸設備異常，同日22時8分許海纜監測芯發出告警通知，依船軌跡圖疑似勾到海纜產生拉扯導致海纜受損，經軌跡判斷該船約費時2小時才掙脫",
  translation:
    "after crossing the cable the vessel slowed at about 21:40, apparently bottom trawling; at about 21:52 the transmission equipment showed a fault, and at about 22:08 the cable's monitoring fibre raised an alarm. The track chart suggests it hooked the cable and pulled it until it was damaged, and that the vessel took about 2 hours to break free",
};
const CAUSE_CITATION = {
  sourceId: 1,
  quote: "駕駛上開漁船進行南北向拖網捕撈作業，致其拖網纏繞海底沉船遺留之錨鈎，因而拉扯海纜致毀壞臺馬第二海纜（TDM2）其中兩芯。",
  translation: "trawling north and south with that vessel, its net fouled an anchor left on the seabed by a sunken ship, which pulled the cable and destroyed two of the Taiwan-Matsu No. 2 (TDM2) cable's fibres.",
};

export const MINLIANYU_60138_2025: CableCase = {
  slug: "minlianyu-60138-2025",
  title: "Minlianyu 60138 trawl snag",
  subtitle: "Off Dongyin, Matsu Islands, 7 October 2025",
  summary:
    "The Chinese bottom trawler Minlianyu 60138 trawled across the Taiwan-Matsu No. 2 cable north-east of Dongyin, and its net caught an old anchor lying on the seabed that pulled the cable until two of its fibres broke at 21:52 local time. A court found the master negligent and sentenced him to three months, convertible to a fine; he paid Chunghwa Telecom NT$250,000 and was deported. The court publishes the fault's coordinates; the trawler's positions are placed from its descriptions.",
  vessel: {
    name: "Minlianyu 60138",
    kind: "fishing",
    flag: "China",
    type: "Bottom trawler, under 45 m",
    // No published length. 45 m is the upper bound the court gives through the master's licence (vessels under
    // 45 m), so the hull is drawn at most this long.
    lengthMetres: 45,
    imo: null,
    mmsi: null,
    citations: [
      {
        sourceId: 1,
        quote: "吳用春為大陸地區「閩連漁60138」號漁船船長",
        translation: "Wu Yongchun is the master of the mainland Chinese fishing vessel Minlianyu 60138",
      },
      {
        sourceId: 1,
        quote: "「閩連漁60138」漁船為單船底拖網具作業，拖網網具長度約200公尺",
        translation: "the Minlianyu 60138 is a single-boat bottom trawler with a net about 200 m long",
      },
      {
        sourceId: 1,
        quote: "被告領有船長證，可駕駛船舶長度小於45公尺之漁業船舶",
        translation: "the defendant holds a master's licence for fishing vessels under 45 m long",
      },
    ],
  },
  window: { startUtc: "2025-10-07T12:30:00Z", endUtc: "2025-10-07T17:30:00Z" },
  localTime: { place: "Dongyin", timeZone: "Asia/Taipei" },
  seabedArea: "matsu",
  track: [
    {
      atUtc: "2025-10-07T13:39:00Z",
      longitude: 120.57971,
      latitude: 26.3991,
      precision: "area",
      place: "Over Taiwan-Matsu No. 2, north-east of Dongyin",
      placement:
        "The court's fault coordinate (26.39910 N, 120.57971 E). The Coast Guard's track puts the trawler about 0.06 nmi (111 m) from the reported damage position, and the court accepts up to 300 m between ship and fault as normal; the drawn point is the fault itself.",
      citations: [HOVER_CITATION, FAULT_PLACE_CITATION],
    },
    {
      atUtc: "2025-10-07T14:01:00Z",
      longitude: 120.57971,
      latitude: 26.3991,
      precision: "area",
      place: "Still over the cable, 0.06 nautical miles from the reported damage",
      placement: "The same point: at 22:01 local time the Coast Guard's track still has the trawler 0.06 nmi (111 m) from the damage position.",
      citations: [HOVER_CITATION],
    },
    {
      atUtc: "2025-10-07T15:00:00Z",
      longitude: 120.60329,
      latitude: 26.36573,
      precision: "area",
      place: "About 5 nautical miles east of Dongyin lighthouse",
      placement: "5 nmi (9.3 km) due east of Dongyin lighthouse (OpenStreetMap Nominatim, lighthouse node 5146186234, 26.36576 N, 120.51034 E); 4.4 km south-south-east of the fault.",
      citations: [{ sourceId: 1, quote: "海巡人員於114年10月7日23時許在東引燈塔東方約5浬處發現被告駕駛「閩連漁60138」號漁船之事實。", translation: "That at about 23:00 on 7 October 2025 Coast Guard officers found the defendant's Minlianyu 60138 about 5 nautical miles east of Dongyin lighthouse." }],
    },
  ],
  // The Coast Guard's track charts are in the court file but not published, and the court redacts the MMSI.
  recordedTrack: null,
  dragWindow: {
    startUtc: "2025-10-07T13:40:00Z",
    endUtc: "2025-10-07T15:40:00Z",
    citations: [SNAG_CITATION, CAUSE_CITATION],
  },
  cuts: [
    {
      cableName: "Taiwan-Matsu No. 2 (TDM2)",
      label: "Taiwan-Matsu No. 2",
      owner: "Chunghwa Telecom",
      atUtc: "2025-10-07T13:52:00Z",
      longitude: 120.57971,
      latitude: 26.3991,
      precision: "coordinates",
      placement: "The coordinate the court gives, which Chunghwa Telecom worked out from the fibre's signal return time (180.6 km from Tamsui). The court notes the cable may have shifted from its laid route over the years.",
      citations: [FAULT_TIME_CITATION, FAULT_PLACE_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2025-10-07T13:39:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Heading south, the trawler lingers over the cable",
      citations: [HOVER_CITATION],
    },
    {
      atUtc: "2025-10-07T13:40:00Z",
      isTimeApproximate: false,
      kind: "anchor",
      title: "Slows while bottom trawling: the net has caught an old anchor on the seabed",
      citations: [SNAG_CITATION, CAUSE_CITATION],
    },
    {
      atUtc: "2025-10-07T13:52:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Taiwan-Matsu No. 2 faults: two of its twelve fibres break",
      citations: [
        FAULT_TIME_CITATION,
        {
          sourceId: 1,
          quote: "臺馬第二海纜原共有12芯，其中2芯斷線毀損之事實。",
          translation: "That the Taiwan-Matsu No. 2 cable had 12 fibres, 2 of which were broken.",
        },
      ],
    },
    {
      atUtc: "2025-10-07T14:00:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "The crew haul the net and find an anchor caught in it",
      citations: [
        {
          sourceId: 1,
          quote: "第二次起網時間約為22時許，第二次起網是因為發現絞纜，其於拖網作業時發現異常，即推進油門相同但速度有差，表示海底有東西卡住，其拉到疑似沉船之物，拉起網發現勾住一個錨",
          translation:
            "the second haul was at about 22:00, because the gear had fouled: while trawling he noticed that the speed dropped at the same throttle, meaning something on the seabed had caught; he had pulled what seemed to be a wreck, and on hauling the net found an anchor hooked in it",
        },
      ],
    },
    {
      atUtc: "2025-10-07T14:08:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "The cable's monitoring fibre raises an alarm; Chunghwa Telecom reports the damage",
      citations: [
        SNAG_CITATION,
        {
          sourceId: 2,
          quote: "海巡署於去年10月7日22時許接獲中華電信報案稱臺馬第二海纜受損故障後",
          translation: "after the Coast Guard received Chunghwa Telecom's report at about 22:00 on 7 October last year that the Taiwan-Matsu No. 2 cable was damaged",
        },
      ],
    },
    {
      atUtc: "2025-10-07T15:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "The Coast Guard finds the trawler 5 nautical miles east of Dongyin lighthouse",
      citations: [{ sourceId: 1, quote: "海巡人員於114年10月7日23時許在東引燈塔東方約5浬處發現被告駕駛「閩連漁60138」號漁船之事實。", translation: "That at about 23:00 on 7 October 2025 Coast Guard officers found the defendant's Minlianyu 60138 about 5 nautical miles east of Dongyin lighthouse." }],
    },
    {
      atUtc: "2025-10-07T17:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "Coast Guard officers board the trawler and take the master in",
      citations: [
        {
          sourceId: 2,
          quote: "於翌（8）日1時許登檢「閩」船，將船長吳O春帶回偵辦",
          translation: "at about 01:00 the next day (the 8th) it boarded the Min ship and took the master, Wu O-chun, in for investigation",
        },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2025-12-04T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Lienchiang District Court: negligent destruction of a cable, three months, convertible to a fine",
      citations: [
        {
          sourceId: 1,
          quote: "吳用春犯過失毀壞海纜纜線罪，處有期徒刑參月，如易科罰金，以新臺幣壹仟元折算壹日。",
          translation: "Wu Yongchun is guilty of negligently destroying a submarine cable and is sentenced to three months in prison, convertible to a fine at NT$1,000 a day.",
        },
        {
          sourceId: 1,
          quote: "被告已與中華電信公司達成和解，賠付中華電信公司修復費用新臺幣25萬元之事實。",
          translation: "That the defendant settled with Chunghwa Telecom and paid it NT$250,000 toward the repair.",
        },
      ],
    },
    {
      atUtc: "2026-01-08T01:40:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "The sentence is final; the master is deported to Fuzhou from Nangan",
      citations: [
        {
          sourceId: 2,
          quote: "全案被告船長業經福建連江地方法院於114年12月4日判處有期徒刑3個月確定。",
          translation: "The master was sentenced by the Lienchiang District Court on 4 December 2025 to three months in prison, and the judgment is final.",
        },
        {
          sourceId: 2,
          quote: "海巡署會同移民署於上午9時40分，由南竿福澳港循小三通模式，強制吳員出境至中國福州黃岐港。",
          translation: "At 09:40 the Coast Guard and the Immigration Agency deported Wu from Fuao harbour on Nangan to Huangqi harbour in Fuzhou, China, by the Mini Three Links route.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Fujian Lienchiang District Court",
      title: "114年度訴字第20號刑事判決 (with the Lienchiang District Prosecutors Office indictment, 114年度偵字第127號)",
      url: "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=LCDM%2c114%2c%e8%a8%b4%2c20%2c20251204%2c1&ot=in",
      publishedOn: "2025-12-04",
      archivedUrl: "https://web.archive.org/web/20261017163109/https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=LCDM%2C114%2C%E8%A8%B4%2C20%2C20251204%2C1&ot=in",
    },
    {
      id: 2,
      publisher: "Coast Guard Administration, Ocean Affairs Council",
      title: "我國司法公正裁判體現法治價值 海巡署堅定執法守護海纜安全",
      url: "https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=166730&ctNode=650&mp=999",
      publishedOn: "2026-01-08",
      archivedUrl: "https://web.archive.org/web/20260122074450/https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=166730&ctNode=650&mp=999",
    },
  ],
};
