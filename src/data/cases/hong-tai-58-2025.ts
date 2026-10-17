import type { CableCase } from "@/lib/cases/case-file";

// The Hong Tai 58 anchor drag, 22 to 25 February 2025. Sources, quotes and conversions:
// plan/research/cases/hong-tai-58-2025.md (source ids below keep that file's numbering). Taiwan uses CST (UTC+8)
// all year; every time here is UTC. No authority published a coordinate for the ship or the break (the court
// redacts them), so every position is placed from a written description and says how in `placement`.

const LOITER_CITATION = {
  sourceId: 1,
  quote: "海巡署表示，「宏」輪於2月22日1910時至2月25日3時於將軍漁港西北方6浬(臺澎第三海纜線北方0.5浬)滯留，海巡署全程監控，並通報安平港信號台廣播「宏」輪7次，惟均無回應。",
  translation:
    "The Coast Guard said the Hong ship lingered 6 nautical miles north-west of Jiangjun fishing harbour (0.5 nautical miles north of the Taiwan-Penghu No. 3 cable line) from 19:10 on 22 February to 03:00 on 25 February; the Coast Guard watched it throughout and had the Anping port signal station call it 7 times, with no answer.",
};
const PATROL_CITATION = {
  sourceId: 1,
  quote: "台南海巡隊10079艇於0230時抵達將軍漁港西北方6浬，發現「宏」輪下錨滯留，即實施廣播驅離，0308時「宏」輪開始往西北方航離",
  translation:
    "Tainan Coast Guard boat 10079 reached the point 6 nautical miles north-west of Jiangjun fishing harbour at 02:30, found the Hong ship lying at anchor and broadcast orders to leave; at 03:08 the Hong ship began to sail away to the north-west",
};
const BREAK_CITATION = {
  sourceId: 2,
  quote: "114年2月25日凌晨3時3分，「臺澎三號」海纜位於我國臺南北門14.7公里處發生全斷障礙。",
  translation: "At 03:03 on 25 February 2025, the Taiwan-Penghu No. 3 cable suffered a total break 14.7 km off Beimen, Tainan.",
};
const PROSECUTORS_PLACE_CITATION = {
  sourceId: 3,
  quote: "於民國114年2月25日凌晨，在臺南市北門區西方外海5海浬附近，指示船員將錨爪釋放下水，並駕船在臺澎3號海纜線上方做Z字形移動，利用貨輪錨爪勾斷臺澎3號海纜線",
  translation:
    "in the early hours of 25 February 2025, about 5 nautical miles off Beimen District, Tainan, to the west, he had the crew let go the anchor and steered the ship in a zigzag over the Taiwan-Penghu No. 3 cable, hooking and breaking it with the anchor",
};
const COURT_TIMES_CITATION = {
  sourceId: 4,
  quote: "「宏泰58」貨船並於同日3時8分許完全起錨，期間○○第○海纜纜線因不堪「宏泰58」貨船船錨之外力拉扯而完全斷裂，無法正常傳輸通訊信號。中華電信公司於同日3時3分許收到纜線機房斷線無訊號之通知後，於同日3時24分許通報海巡署",
  translation:
    "the Hong Tai 58 had its anchor fully up at about 3:08 the same day; meanwhile the cable, unable to bear the pull of the ship's anchor, broke completely and could no longer carry signals. Chunghwa Telecom was told at about 3:03 that the cable station had lost the signal, and at about 3:24 it reported to the Coast Guard",
};
const ANCHOR_DOWN_CITATION = {
  sourceId: 4,
  quote:
    "自民國114年2月22日21時30分許起至2月25日3時許止，指示秦國壯、張立生在上開警戒區將「宏泰58」貨船6節錨鍊（約160公尺長）及錨爪釋放下水，然錨爪未確實固定於海床上，「宏泰58」貨船船身因此並未固定，王玉亮仍容任「宏泰58」貨船船身於海面上以Z字型徘徊。",
  translation:
    "from about 21:30 on 22 February 2025 to about 03:00 on 25 February he had Qin Guozhuang and Zhang Lisheng let go 6 shackles of chain (about 160 m) and the anchor in the warning zone, but the anchor never held on the seabed, so the hull was not fixed, and Wang Yuliang let the ship wander over the sea in a zigzag.",
};

export const HONG_TAI_58_2025: CableCase = {
  slug: "hong-tai-58-2025",
  title: "Hong Tai 58 anchor drag",
  subtitle: "Off Tainan, Taiwan, 22 to 25 February 2025",
  summary:
    "The Togo-flagged cargo ship Hong Tai 58 lay for two and a half days in a no-anchoring zone off Tainan with an anchor that never held, its hull swinging in a zigzag over the Taiwan-Penghu No. 3 cable. The cable broke at 03:03 local time on 25 February, five minutes before the ship had its anchor up. A court sentenced the master to three years for destroying the cable, and dismissed the prosecutors' appeal. No authority published the ship's positions, so the track below is placed from their written descriptions.",
  vessel: {
    name: "Hong Tai 58",
    kind: "general-cargo",
    flag: "Togo",
    type: "General cargo ship, 90 m",
    lengthMetres: 90,
    imo: null,
    mmsi: "671756000",
    citations: [
      {
        sourceId: 1,
        quote: "涉嫌的多哥籍「宏泰」貨輪，經查為中資背景的權宜輪，船上8名船員均為中國籍人士",
        translation: "the suspected Togo-flagged Hong Tai cargo ship was found to be a Chinese-backed flag-of-convenience ship, and its 8 crew are all Chinese nationals",
      },
      {
        sourceId: 1,
        quote: "船舷外觀為「宏泰168」，經以無線電與「宏」輪通聯時獲復，該輪為「宏泰168」 ，惟AIS顯示為「宏泰58」",
        translation: "the name on the hull was Hong Tai 168, and the ship answered on the radio that it was Hong Tai 168, but its AIS showed Hong Tai 58",
      },
      { sourceId: 9, quote: "Hongtai58 - Cargo Ship, MMSI 671756000, Callsign , Flag Togo" },
      { sourceId: 9, quote: "Length: 90.0 m" },
    ],
  },
  window: { startUtc: "2025-02-22T11:00:00Z", endUtc: "2025-02-25T05:00:00Z" },
  localTime: { place: "Tainan", timeZone: "Asia/Taipei" },
  seabedArea: "taiwan-penghu",
  track: [
    {
      atUtc: "2025-02-22T11:10:00Z",
      longitude: 120.01038,
      latitude: 23.28235,
      precision: "area",
      place: "6 nautical miles north-west of Jiangjun fishing harbour, 0.5 nautical miles north of the cable",
      placement:
        "6 nmi (11.1 km) at 315 degrees from Jiangjun fishing harbour (OpenStreetMap Nominatim, marina node 1798499222, 23.21171 N, 120.08731 E). The prosecutors' description, 5 nmi west of Beimen District (Nominatim, 23.26792 N, 120.12572 E), lands 3.0 km to the south-east.",
      citations: [LOITER_CITATION, PROSECUTORS_PLACE_CITATION],
    },
    {
      atUtc: "2025-02-24T18:30:00Z",
      longitude: 120.01038,
      latitude: 23.28235,
      precision: "area",
      place: "The same spot, where the Coast Guard boat found the ship at anchor",
      placement: "The same point as the first position: the Coast Guard gives the same 6 nmi north-west of Jiangjun fishing harbour for its boat's arrival.",
      citations: [PATROL_CITATION],
    },
    {
      atUtc: "2025-02-24T19:08:00Z",
      longitude: 120.01038,
      latitude: 23.28235,
      precision: "area",
      place: "The same spot, anchor up, turning north-west",
      placement: "The same point: the ship had not moved off before 03:08 local time, when its anchor was fully up and it began to sail north-west.",
      citations: [PATROL_CITATION, COURT_TIMES_CITATION],
    },
    {
      atUtc: "2025-02-25T00:48:00Z",
      longitude: 120.0,
      latitude: 23.05,
      precision: "area",
      place: "At sea west of Qigu, on the way to Anping (no source gives this leg)",
      placement:
        "Not published. A straight line from the anchoring spot to Anping crosses the Qigu coast on the drawn block, so the track turns once at 120.00 E, 23.05 N, where both legs stay at sea (checked on the GEBCO block). Time: the 9 h 7 min between 03:08 and 12:15 local time split by distance, 25.9 of 41.6 km.",
      citations: [
        {
          sourceId: 1,
          quote: "經協調航港局提供船席後，於1215時成功將「宏」輪押返安平港。",
          translation: "After the Maritime and Port Bureau provided a berth, the Hong ship was escorted back into Anping harbour at 12:15.",
        },
      ],
    },
    {
      atUtc: "2025-02-25T04:15:00Z",
      longitude: 120.14,
      latitude: 22.985,
      precision: "named-place",
      place: "Anping harbour, Tainan",
      placement: "The Anping harbour entrance, 2.1 km west of the Nominatim harbour centroid (relation 12220341, 22.98315 N, 120.16039 E), which falls on the quay on the drawn block.",
      citations: [
        {
          sourceId: 1,
          quote: "經協調航港局提供船席後，於1215時成功將「宏」輪押返安平港。",
          translation: "After the Maritime and Port Bureau provided a berth, the Hong ship was escorted back into Anping harbour at 12:15.",
        },
      ],
    },
  ],
  // The ship's AIS track is in the court file (a Maritime and Port Bureau letter of 13 Mar 2025) but not published.
  recordedTrack: null,
  dragWindow: {
    startUtc: "2025-02-22T13:30:00Z",
    endUtc: "2025-02-24T19:08:00Z",
    citations: [ANCHOR_DOWN_CITATION, COURT_TIMES_CITATION],
  },
  cuts: [
    {
      cableName: "Taiwan-Penghu No. 3 (TP3)",
      label: "Taiwan-Penghu No. 3",
      owner: "Chunghwa Telecom",
      atUtc: "2025-02-24T19:03:00Z",
      longitude: 120.01038,
      latitude: 23.27403,
      precision: "area",
      placement:
        "0.5 nmi (0.93 km) due south of the anchoring spot, where the Coast Guard puts the cable line. Check: the point is 11.8 km in a straight line from Beimen District (Nominatim) against the 14.7 km of cable the Ministry of Digital Affairs gives, and the GEBCO block reads 14 m of water there against the 18 m in the court's NEC fault record.",
      citations: [BREAK_CITATION, LOITER_CITATION, COURT_TIMES_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2025-02-22T11:10:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Stops 6 nautical miles north-west of Jiangjun fishing harbour, over the cable's warning zone",
      citations: [LOITER_CITATION],
    },
    {
      atUtc: "2025-02-22T13:30:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "The master has the anchor and 6 shackles of chain (about 160 m) let go; it never holds",
      citations: [ANCHOR_DOWN_CITATION],
    },
    {
      atUtc: "2025-02-24T18:30:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Coast Guard boat 10079 finds the ship at anchor and orders it away",
      citations: [PATROL_CITATION],
    },
    {
      atUtc: "2025-02-24T19:03:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Taiwan-Penghu No. 3 breaks completely, 14.7 km off Beimen",
      citations: [BREAK_CITATION, COURT_TIMES_CITATION],
    },
    {
      atUtc: "2025-02-24T19:08:00Z",
      isTimeApproximate: false,
      kind: "anchor",
      title: "Anchor fully up; the ship heads north-west",
      citations: [PATROL_CITATION, COURT_TIMES_CITATION],
    },
    {
      atUtc: "2025-02-24T19:24:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Chunghwa Telecom reports the break; the Coast Guard stops the ship, whose hull reads Hong Tai 168",
      citations: [
        {
          sourceId: 1,
          quote: "0324時海巡署接獲中華電信初判疑似外力破壞時，立即通報10079艇攔查「宏」船，船舷外觀為「宏泰168」",
          translation:
            "At 03:24, when Chunghwa Telecom's first assessment of suspected outside damage reached the Coast Guard, it told boat 10079 to stop and inspect the Hong ship at once; the name on its hull was Hong Tai 168",
        },
        COURT_TIMES_CITATION,
      ],
    },
    {
      atUtc: "2025-02-25T04:15:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Escorted into Anping harbour; the case goes to the Tainan prosecutors",
      citations: [
        {
          sourceId: 1,
          quote: "經協調航港局提供船席後，於1215時成功將「宏」輪押返安平港。",
          translation: "After the Maritime and Port Bureau provided a berth, the Hong ship was escorted back into Anping harbour at 12:15.",
        },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2025-04-11T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "The master is charged with destroying the cable; the 7 crew are not charged",
      citations: [
        PROSECUTORS_PLACE_CITATION,
        {
          sourceId: 3,
          quote: "另被告即「宏泰 58」貨輪大陸籍船員秦○○、劉○○、張○○、黃○、姜○○、張△△、駱○○等 7 人經專案小組調查後，認渠等犯罪嫌疑不足，均為不起訴處分",
          translation: "The 7 mainland Chinese crew of the Hong Tai 58 were found, after the task force's inquiry, to lack sufficient suspicion of a crime, and none was charged",
        },
      ],
    },
    {
      atUtc: "2025-06-12T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Tainan District Court: guilty of destroying a cable, three years in prison",
      citations: [
        {
          sourceId: 4,
          quote: "王玉亮犯電信管理法第七十二條第一項之毀壞纜線罪，處有期徒刑參年。",
          translation: "Wang Yuliang is guilty of destroying a cable under Article 72, paragraph 1, of the Telecommunications Management Act, and is sentenced to three years in prison.",
        },
      ],
    },
    {
      atUtc: "2025-08-29T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "High Court, Tainan branch: the prosecutors' appeal for a longer sentence is dismissed",
      citations: [
        {
          sourceId: 5,
          quote: "上訴駁回。",
          translation: "The appeal is dismissed.",
        },
        {
          sourceId: 5,
          quote: "檢察官於本院準備、審理程序已明確表示僅就量刑部分提起上訴",
          translation: "The prosecutor stated clearly in the preparatory and trial proceedings that the appeal was against the sentence only",
        },
      ],
    },
    {
      atUtc: "2025-12-24T08:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "The Coast Guard states the three-year sentence is final",
      citations: [
        {
          sourceId: 7,
          quote: "6月12日臺灣臺南地方法院判處王姓船長犯《電信管理法》第72條第1項之毀壞纜線罪，處有期徒刑3年定讞。",
          translation: "On 12 June the Tainan District Court found the master, surnamed Wang, guilty of destroying a cable under Article 72, paragraph 1, of the Telecommunications Management Act; the three-year sentence is final.",
        },
      ],
    },
    {
      atUtc: "2026-03-24T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Civil judgment: the master must pay Chunghwa Telecom NT$18,222,398",
      citations: [
        {
          sourceId: 6,
          quote: "被告應給付原告新臺幣1,822萬2,398元，及自民國114年5月29日起至清償日止，按週年利率百分之5計算之利息。",
          translation: "The defendant shall pay the plaintiff NT$18,222,398, with interest at 5% a year from 29 May 2025 until paid.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Coast Guard Administration, Ocean Affairs Council",
      title: "多哥籍「宏泰」貨輪疑似拖斷臺澎第三海纜 海巡署超前部署押返安平港深入偵辦",
      url: "https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=164475&ctNode=650&mp=999",
      publishedOn: "2025-02-25",
      archivedUrl: "https://web.archive.org/web/20260123214121/https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=164475&ctNode=650&mp=999",
    },
    {
      id: 2,
      publisher: "Ministry of Digital Affairs",
      title: "「臺澎三號」海纜全斷 數發部緊急調度海纜備援並促加速修復作業",
      url: "https://moda.gov.tw/press/press-releases/15362",
      publishedOn: "2025-02-25",
      archivedUrl: "https://web.archive.org/web/20260814130344/https://moda.gov.tw/press/press-releases/15362",
    },
    {
      id: 3,
      publisher: "Taiwan Tainan District Prosecutors Office",
      title: "南檢偵辦大陸籍王姓船長駕駛「宏泰58」貨輪在我國海域毀壞中華電信公司臺澎3號海纜線一案提起公訴",
      url: "https://www.tnc.moj.gov.tw/media/393934/1140411%E5%8D%97%E6%AA%A2%E5%81%B5%E8%BE%A6%E5%AE%8F%E6%B3%B058%E8%B2%A8%E8%BC%AA%E6%AF%80%E5%A3%9E%E6%88%91%E5%9C%8B%E9%9B%BB%E7%BA%9C%E7%B7%9A%E6%A1%88%E6%8F%90%E8%B5%B7%E5%85%AC%E8%A8%B4%E6%96%B0%E8%81%9E%E7%A8%BF.pdf?mediaDL=true",
      publishedOn: "2025-04-11",
      archivedUrl:
        "https://web.archive.org/web/20261017162313/https://www.tnc.moj.gov.tw/media/393934/1140411%E5%8D%97%E6%AA%A2%E5%81%B5%E8%BE%A6%E5%AE%8F%E6%B3%B058%E8%B2%A8%E8%BC%AA%E6%AF%80%E5%A3%9E%E6%88%91%E5%9C%8B%E9%9B%BB%E7%BA%9C%E7%B7%9A%E6%A1%88%E6%8F%90%E8%B5%B7%E5%85%AC%E8%A8%B4%E6%96%B0%E8%81%9E%E7%A8%BF.pdf?mediaDL=true",
    },
    {
      id: 4,
      publisher: "Taiwan Tainan District Court",
      title: "114年度訴字第235號刑事判決",
      url: "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c114%2c%e8%a8%b4%2c235%2c20250612%2c1&ot=in",
      publishedOn: "2025-06-12",
      archivedUrl: "https://web.archive.org/web/20261017162443/https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2C114%2C%E8%A8%B4%2C235%2C20250612%2C1&ot=in",
    },
    {
      id: 5,
      publisher: "Taiwan High Court, Tainan Branch",
      title: "114年度上訴字第1395號刑事判決",
      url: "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2c114%2c%e4%b8%8a%e8%a8%b4%2c1395%2c20250829%2c1&ot=in",
      publishedOn: "2025-08-29",
      archivedUrl: "https://web.archive.org/web/20261017162618/https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2C114%2C%E4%B8%8A%E8%A8%B4%2C1395%2C20250829%2C1&ot=in",
    },
    {
      id: 6,
      publisher: "Taiwan Tainan District Court",
      title: "114年度重訴字第233號民事判決",
      url: "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDV%2c114%2c%e9%87%8d%e8%a8%b4%2c233%2c20260324%2c1&ot=in",
      publishedOn: "2026-03-24",
      archivedUrl: "https://web.archive.org/web/20261017162744/https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDV%2C114%2C%E9%87%8D%E8%A8%B4%2C233%2C20260324%2C1&ot=in",
    },
    {
      id: 7,
      publisher: "Coast Guard Administration, Ocean Affairs Council",
      title: "針對中國國台辦指出「兩位臺灣民眾涉及操控《宏泰58》向大陸走私凍品，已對該2人發出懸賞通告」一事，海巡署特嚴正駁斥",
      url: "https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=166625&ctNode=650&mp=999",
      publishedOn: "2025-12-24",
      archivedUrl: "https://web.archive.org/web/20251225085634/https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=166625&ctNode=650&mp=999",
    },
    {
      id: 9,
      publisher: "vesseltracker.com",
      title: "Hongtai58, Cargo Ship, MMSI 671756000, Flag Togo",
      url: "https://www.vesseltracker.com/en/Ships/Hongtai58-I3407827.html",
      publishedOn: "2026-10-17",
      archivedUrl: "https://web.archive.org/web/20261017162928/https://www.vesseltracker.com/en/Ships/Hongtai58-I3407827.html",
    },
  ],
};
