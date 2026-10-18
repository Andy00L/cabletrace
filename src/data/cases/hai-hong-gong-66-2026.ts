import type { CableCase } from "@/lib/cases/case-file";

// The Hai Hong Gong 66 salvage damage, 30 March 2026, at Dongyin in the Matsu Islands. Sources, quotes and
// conversions: plan/research/cases/hai-hong-gong-66-2026.md (source ids below keep that file's numbering). Taiwan
// uses CST (UTC+8) all year; every time here is UTC. No anchor was dragged: prosecutors found that debris from the
// wreck the ship was clearing landed on the cable. The sources give only parts of the night, so times are marked
// approximate, and the ship's position is a named place.

const CLEARANCE_CITATION = {
  sourceId: 1,
  quote: "船體於3月21日凌晨漂流擱淺至東引北澳岸際，嗣經船東代表委託中國籍工作平台船「海虹工66」（下稱海船）於3月30日執行船體移除作業",
  translation:
    "the hull drifted aground on the Beiao shore of Dongyin early on 21 March; the owner's representative then hired the Chinese work platform ship Hai Hong Gong 66 to remove the hull on 30 March",
};
const ALARM_CITATION = {
  sourceId: 1,
  quote: "金馬澎分署於3月31日凌晨接獲中華電信公司通報臺馬第三海纜北竿至東引段疑發生障礙告警，懷疑該處海纜可能遭施工導致受損，爰航政單位立即要求「海」船停止作業",
  translation:
    "Early on 31 March the Kinmen-Matsu-Penghu branch received Chunghwa Telecom's report of a suspected fault alarm on the Beigan to Dongyin segment of Taiwan-Matsu No. 3, suspected to have been caused by the work there, so the navigation authority at once told the Hai ship to stop work",
};
const DAMAGE_CITATION = {
  sourceId: 2,
  quote: "數位發展部3月30日夜間接獲中華電信通報，臺馬三號海纜位於我國馬祖東引約2.64公里處，發生部分芯線受損障礙。",
  translation: "On the night of 30 March the Ministry of Digital Affairs was told by Chunghwa Telecom that Taiwan-Matsu No. 3 had a fault with some fibres damaged, about 2.64 km from Dongyin, Matsu.",
};
const DEBRIS_CITATION = {
  sourceId: 3,
  quote: "因中國籍漁船「閩連漁63896」遇難擱淺於東引鄉北澳口岸際，3月30日晚間執行「閩」船打撈過程中，因漁船碎裂船體砸中台馬第3海纜導致受損。",
  translation:
    "Because the Chinese fishing vessel Minlianyu 63896 had been wrecked and stranded on the Beiao shore of Dongyin, during the salvage of the Min ship on the evening of 30 March, the fishing vessel's broken hull struck Taiwan-Matsu No. 3 and damaged it.",
};

export const HAI_HONG_GONG_66_2026: CableCase = {
  slug: "hai-hong-gong-66-2026",
  title: "Hai Hong Gong 66 salvage damage",
  subtitle: "Dongyin, Matsu Islands, 30 March 2026",
  summary:
    "The Chinese work platform ship Hai Hong Gong 66 was clearing the wreck of a Chinese trawler stranded on Dongyin's Beiao shore when the Beigan to Dongyin segment of Taiwan-Matsu No. 3 was damaged late on 30 March 2026. Divers later found wreck debris on the cable, and prosecutors declined to charge the master: he had checked his anchoring points with Chunghwa Telecom, and nobody knew the cable lay under the wreck. No anchor was dragged; the ship's position is the named shore.",
  vessel: {
    name: "Hai Hong Gong 66",
    kind: "general-cargo",
    flag: "China",
    type: "Work platform ship (listed as a dredger), 80 m",
    lengthMetres: 80,
    imo: null,
    mmsi: null,
    citations: [
      CLEARANCE_CITATION,
      { sourceId: 4, quote: "HAI HONG GONG 66 (IMO 8537504) is a Dredger built in 2012" },
      { sourceId: 4, quote: "Length Overall (m) 80.00" },
    ],
  },
  window: { startUtc: "2026-03-30T08:00:00Z", endUtc: "2026-03-31T02:00:00Z" },
  localTime: { place: "Dongyin", timeZone: "Asia/Taipei" },
  seabedArea: "matsu",
  track: [
    {
      atUtc: "2026-03-30T11:00:00Z",
      longitude: 120.49129,
      latitude: 26.374,
      precision: "named-place",
      place: "At the wreck on the Beiao shore of Dongyin",
      placement:
        "Beiao bay (OpenStreetMap Nominatim, way 904466212, 26.37185 N, 120.49129 E) moved 240 m north to 26.374 N, the first water vertex of the matsu block. The time is the sources' \"evening\" of 30 March, drawn at 19:00 local time.",
      citations: [CLEARANCE_CITATION, DEBRIS_CITATION],
    },
    {
      atUtc: "2026-03-30T18:00:00Z",
      longitude: 120.49129,
      latitude: 26.374,
      precision: "named-place",
      place: "Still at the wreck when work is stopped",
      placement: "The same point: the ship was still working at the wreck when the navigation authority stopped it after the alarm, early on 31 March (drawn at 02:00 local time).",
      citations: [ALARM_CITATION],
    },
  ],
  recordedTrack: null,
  dragWindow: null,
  cuts: [
    {
      cableName: "Taiwan-Matsu No. 3 (TM3)",
      label: "Taiwan-Matsu No. 3",
      owner: "Chunghwa Telecom",
      atUtc: "2026-03-30T15:00:00Z",
      longitude: 120.49129,
      latitude: 26.374,
      precision: "named-place",
      placement:
        "At the wreck: prosecutors found the wreck's debris lying on the cable there. The Ministry of Digital Affairs' 2.64 km from Dongyin is not used, because Beiao bay is only 0.65 km from the Dongyin Chunghwa Telecom office (Nominatim way 431591218) and the landing the distance counts from is not published. Time: \"late at night\" on 30 March, drawn at 23:00 local time.",
      citations: [
        DAMAGE_CITATION,
        DEBRIS_CITATION,
        {
          sourceId: 3,
          quote: "海纜受損後，中華電信派員進行水下探勘，才知道擱淺船體部分殘骸壓在海纜上方。",
          translation: "Only after the cable was damaged did Chunghwa Telecom send divers down and learn that part of the stranded hull's debris was lying on the cable.",
        },
      ],
    },
  ],
  events: [
    {
      atUtc: "2026-03-30T11:00:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "The work platform ship begins removing the stranded trawler Minlianyu 63896",
      citations: [CLEARANCE_CITATION, DEBRIS_CITATION],
    },
    {
      atUtc: "2026-03-30T12:00:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Lifting the wreck whole fails, so the crew break up its hull",
      citations: [
        {
          sourceId: 3,
          quote: "中華電信員工證詞指出，「海虹工66」計畫原擬採吊掛擱淺漁船，但因吊掛失敗才改由破壞船體，但現場無人知曉海纜就在船的正下方，亦無人阻止或警告被告應停止作業。",
          translation:
            "A Chunghwa Telecom employee testified that the Hai Hong Gong 66 had planned to lift the stranded trawler, but after the lift failed it turned to breaking up the hull; nobody on site knew the cable lay right under the ship, and nobody stopped the defendant or warned him to stop work.",
        },
      ],
    },
    {
      atUtc: "2026-03-30T15:00:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "Taiwan-Matsu No. 3, Beigan to Dongyin, loses some fibres; traffic is rerouted",
      citations: [
        DAMAGE_CITATION,
        {
          sourceId: 2,
          quote: "數發部表示，此次臺馬三號東引段海纜僅為部分芯線受損，並未影響正常通訊。",
          translation: "The ministry said only some fibres of the Dongyin segment of Taiwan-Matsu No. 3 were damaged, and normal communications were not affected.",
        },
      ],
    },
    {
      atUtc: "2026-03-30T18:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "Chunghwa Telecom reports the alarm; work stops and the Coast Guard boards the ship",
      citations: [
        ALARM_CITATION,
        {
          sourceId: 1,
          quote: "該分署獲報後立即調派巡防艇前往登檢蒐證，除控制施工人員、帶回製作筆錄外，並報請連江地檢署指揮調查",
          translation: "On the report the branch at once sent a patrol boat to board and gather evidence; it took control of the workers and brought them in for statements, and referred the case to the Lienchiang District Prosecutors Office",
        },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2026-07-13T02:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Prosecutors decline to charge the master: insufficient evidence of intent or negligence",
      citations: [
        {
          sourceId: 3,
          quote: "連江地檢日前偵結，認為何姓船長作業前曾與中華電信人員聯繫，難以認定被告應負過失或故意毀損海纜責任，罪嫌不足，將何姓船長不起訴處分。",
          translation:
            "The Lienchiang prosecutors recently closed the investigation: because the master, surnamed He, had been in touch with Chunghwa Telecom staff before working, he could not be held liable for negligently or intentionally damaging the cable; with insufficient evidence, he was not charged.",
        },
        {
          sourceId: 3,
          quote: "檢方根據中華電信員工證詞，與何姓被告手機通訊軟體紀錄等，認為「海虹工66」工作船下錨前，何姓被告確實有向中華電信人員確認下錨位置是否影響海纜安全，且試圖於下錨時避開纜線區域。",
          translation:
            "From the Chunghwa Telecom employees' testimony and the messaging records on He's phone, prosecutors found that before the Hai Hong Gong 66 anchored, He did check with Chunghwa Telecom staff whether the anchoring positions would endanger the cable, and tried to keep the anchors clear of the cable area.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Coast Guard Administration, Kinmen-Matsu-Penghu Branch",
      title: "有關媒訊報導中國籍漁船擱淺馬祖東引疑似因清除作業造成海纜受損，金馬澎分署說明如下",
      url: "https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=167354&ctNode=10621&mp=9998",
      publishedOn: "2026-04-01",
      archivedUrl: "https://web.archive.org/web/20261017163340/https://www.cga.gov.tw/GipOpen/wSite/ct?xItem=167354&ctNode=10621&mp=9998",
    },
    {
      id: 2,
      publisher: "Ministry of Digital Affairs",
      title: "臺馬三號東引段海纜部分芯線受損 數發部：已即刻啟動訊務調度 確保東引地區通訊穩定",
      url: "https://moda.gov.tw/press/press-releases/19338",
      publishedOn: "2026-04-01",
      archivedUrl: "https://web.archive.org/web/20260814130804/https://moda.gov.tw/press/press-releases/19338",
    },
    {
      id: 3,
      publisher: "Central News Agency (news report; the non-prosecution decision itself is not published)",
      title: "台馬3號海纜損壞案 工作船長罪嫌不足連江地檢不起訴",
      url: "https://www.cna.com.tw/news/aloc/202607150306.aspx",
      publishedOn: "2026-07-15",
      archivedUrl: "https://web.archive.org/web/20261007165647/https://www.cna.com.tw/news/aloc/202607150306.aspx",
    },
    {
      id: 4,
      publisher: "VesselFinder (matched by name only: no Taiwanese source gives the IMO number)",
      title: "HAI HONG GONG 66, Dredger, IMO 8537504",
      url: "https://www.vesselfinder.com/vessels/details/8537504",
      publishedOn: "2026-10-17",
      archivedUrl: "https://web.archive.org/web/20261017203608/https://www.vesselfinder.com/vessels/details/8537504",
    },
  ],
};
