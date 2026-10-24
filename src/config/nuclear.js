/**
 * 核能電廠狀態（台電即時資料自 2025-05-17 起已沒有核能機組，這裡補上各廠現況）
 *  運轉執照屆期日：核能安全委員會「核能電廠除役管制 → 常見問答」
 *  核一不具／核二、核三具再運轉可行性：經濟部 2025 年 11 月核定台電現況評估報告
 *  核三再運轉計畫：台電 2026-03-27 送審，核安會 2026-09-24 核定（核電廠再運轉審查管制專區）
 *  狀態有變化時更新這裡與 VERIFIED。
 */
export const NUCLEAR_VERIFIED = '2026-10';

export const NUCLEAR = {
  chinshan: {
    short: '核一', shortEn: 'Chinshan',
    place: '新北石門', placeEn: 'Shimen, New Taipei',
    licenseEnd: ['2018-12-05', '2019-07-15'],
    status: '除役中', statusEn: 'Decommissioning', noGas: true,
    note: '2019 年 7 月起進入除役；經濟部評估不具再運轉可行性（2025 年 11 月）。',
    noteEn: 'Decommissioning since July 2019; the economics ministry found a restart not feasible (Nov 2025).'
  },
  kuosheng: {
    short: '核二', shortEn: 'Kuosheng',
    place: '新北萬里', placeEn: 'Wanli, New Taipei',
    licenseEnd: ['2021-12-27', '2023-03-14'],
    status: '停機', statusEn: 'Shut down',
    note: '運轉執照屆期後停機；經濟部評估具再運轉可行性（2025 年 11 月）。',
    noteEn: 'Shut down after its licences expired; the economics ministry found a restart feasible (Nov 2025).'
  },
  maanshan: {
    short: '核三', shortEn: 'Maanshan',
    place: '屏東恆春', placeEn: 'Hengchun, Pingtung',
    licenseEnd: ['2024-07-27', '2025-05-17'],
    status: '停機・再運轉整備', statusEn: 'Shut down · restart prep', mapStatus: '停機', mapStatusEn: 'Shut down',
    note: '台電 2026 年 3 月提出再運轉計畫，核安會 2026 年 9 月 24 日核定；仍須完成自主安全檢查與執行結果報告審查，才可能恢復運轉。',
    noteEn: 'Taipower filed a restart plan in March 2026, approved by the Nuclear Safety Commission on 24 Sep 2026; self safety checks and a results review are still required before any restart.'
  }
};

export const NUCLEAR_IDS = Object.keys(NUCLEAR);

export const NUCLEAR_SOURCES = [
  { label: '核能安全委員會：核電廠再運轉審查管制', en: 'Nuclear Safety Commission: restart review', url: 'https://www.nusc.gov.tw/%E6%A0%B8%E5%AE%89%E7%AE%A1%E5%88%B6/%E6%A0%B8%E9%9B%BB%E5%BB%A0%E5%86%8D%E9%81%8B%E8%BD%89%E5%AF%A9%E6%9F%A5%E7%AE%A1%E5%88%B6--3_50001.html' },
  { label: '核能安全委員會：除役常見問答（運轉執照期限）', en: 'Nuclear Safety Commission: decommissioning FAQ (licence dates)', url: 'https://www.nusc.gov.tw/%E6%A0%B8%E5%AE%89%E7%AE%A1%E5%88%B6/%E6%A0%B8%E8%83%BD%E9%9B%BB%E5%BB%A0%E9%99%A4%E5%BD%B9%E7%AE%A1%E5%88%B6/%E6%B0%91%E7%9C%BE%E5%8F%83%E8%88%87%E6%B4%BB%E5%8B%95%E8%88%87%E5%B8%B8%E8%A6%8B%E5%95%8F%E7%AD%94/%E5%B8%B8%E8%A6%8B%E5%95%8F%E7%AD%94--3_5377_5390_5022.html' },
  { label: '公視新聞：經濟部核定核二、三廠現況評估報告（2025-11）', en: 'PTS News: ministry approves Kuosheng/Maanshan assessment (Nov 2025)', url: 'https://news.pts.org.tw/article/783526' },
  { label: '中央社：核安會核定核三再運轉計畫（2026-09-24）', en: 'CNA: commission approves Maanshan restart plan (24 Sep 2026)', url: 'https://www.cna.com.tw/news/afe/202609240313.aspx' }
];
