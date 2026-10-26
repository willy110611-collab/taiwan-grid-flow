"""
水模式靜態資料（一次性／定期手動跑，由 .github/workflows/water-static.yml 在 Actions 執行；這個環境連不到來源網站）
  1. 臺北市自來水系統管線（data.taipei 工務局公共管線圖資，政府資料開放授權第 1 版）
     → public/water/taipei-trunk.json（管徑 ≥ 300 mm）＋ public/water/taipei/{ix}_{iy}.json（小管，0.02° 一格，放大才載入）
  2. 台水淨水場位置與供水轄區（data.gov.tw 36602，TWD97）→ public/water/plants.json
  3. 水庫基本資料（data.gov.tw 32726：名稱、代碼、有效容量）＋ OSM 水庫範圍（名稱比對取中心，ODbL）→ public/water/reservoirs.json
格式（省空間）：管線 [管徑mm, [lon,lat,lon,lat,...]]，座標 5 位小數
"""
import sys, os, json, math, csv, io, re, collections, urllib.request, xml.etree.ElementTree as ET

OUT = 'public/water'
UA = {'User-Agent': 'Mozilla/5.0 (taiwan-grid-flow; https://github.com/willy110611-collab/taiwan-grid-flow)'}
TILE = 0.02

def get(url, timeout=600):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()

def tm2(x, y):  # TWD97 TM2（EPSG:3826）→ WGS84
    a=6378137.0; f=1/298.257222101; b=a*(1-f); e2=(a*a-b*b)/(a*a); k0=0.9999; lon0=math.radians(121)
    x-=250000; M=y/k0; mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256)); e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    fp=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+(151*e1**3/96)*math.sin(6*mu)+(1097*e1**4/512)*math.sin(8*mu)
    ep2=e2/(1-e2); C1=ep2*math.cos(fp)**2; T1=math.tan(fp)**2; R1=a*(1-e2)/(1-e2*math.sin(fp)**2)**1.5; N1=a/math.sqrt(1-e2*math.sin(fp)**2); D=x/(N1*k0)
    lat=fp-(N1*math.tan(fp)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720)
    lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/math.cos(fp)
    return math.degrees(lon), math.degrees(lat)

def dp(pts, tol):  # Douglas-Peucker（公尺 → 度，約略）
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; n = math.hypot(dx, dy) or 1e-12
    best, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / n
        if d > best: best, idx = d, i
    if best <= tol: return [pts[0], pts[-1]]
    return dp(pts[:idx + 1], tol)[:-1] + dp(pts[idx:], tol)

def flat(pts): return [round(v, 5) for p in pts for v in p]

def taipei():
    B = 'https://data.taipei/api/dataset/af167303-0e5f-45dd-b624-a01f541565ce/resource'
    rids = ['30056122-21c3-4a6d-9f90-274509a08e7a', 'aeeaa0cd-38f0-45f1-9849-762642fb77be', '07946ee4-3537-49c7-a964-606c995e02fe',
            '650ab113-454c-45ba-a8b5-32066265b1a2', '540545ed-5d58-43b3-b1c7-3f6d6e3c73c1', '984276ba-b66a-40f3-9ef1-4e5668b9a3da']
    trunk, tiles, stat = [], collections.defaultdict(list), collections.Counter()
    G = '{http://www.opengis.net/gml}'
    for rid in rids:
        path = f'/tmp/{rid}.xml'
        if not os.path.exists(path): open(path, 'wb').write(get(f'{B}/{rid}/download'))
        for ev, el in ET.iterparse(path, events=('end',)):
            if not el.tag.endswith('UTL_管線_自來水'): continue
            g = {c.tag.split('}')[-1]: (c.text or '') for c in el}
            pos = el.find(f'.//{G}posList'); ls = el.find(f'.//{G}LineString')
            try: d = int(float(g.get('管徑寬度') or 0))
            except ValueError: d = 0
            if pos is None or not pos.text or g.get('使用狀態', '0') != '0': el.clear(); continue  # 只畫使用中
            n = int(ls.get('srsDimension', '3')) if ls is not None else 3
            v = [float(x) for x in pos.text.split()]
            pts = [tm2(v[i], v[i + 1]) for i in range(0, len(v) - n + 1, n)]
            if len(pts) < 2: el.clear(); continue
            stat['m_' + ('trunk' if d >= 300 else 'small')] += float(g.get('管線長度') or 0)
            if d >= 300: trunk.append([d, flat(dp(pts, 0.00002))])
            else:
                cx, cy = pts[0]
                tiles[(int(cx // TILE), int(cy // TILE))].append([d, flat(dp(pts, 0.00001))])
            el.clear()
        os.remove(path)
    os.makedirs(f'{OUT}/taipei', exist_ok=True)
    json.dump({'source': '臺北市政府工務局 公共管線圖資＿自來水系統管線（data.taipei，政府資料開放授權第 1 版；僅供參考）', 'tile': TILE,
               'tiles': sorted(f'{x}_{y}' for x, y in tiles), 'km': {k: round(v / 1000) for k, v in stat.items()}, 'lines': trunk},
              open(f'{OUT}/taipei-trunk.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    for (x, y), arr in tiles.items():
        json.dump(arr, open(f'{OUT}/taipei/{x}_{y}.json', 'w'), separators=(',', ':'))
    print('taipei trunk', len(trunk), 'tiles', len(tiles), dict(stat))

def plants():
    rows = csv.DictReader(io.StringIO(get('https://www.water.gov.tw/opendata/supp7.csv').decode('utf-8-sig')))
    out = []
    for r in rows:
        try: x, y = float(r['X座標(TWD97)']), float(r['Y座標(TWD97)'])
        except (ValueError, KeyError): continue
        if x < 100000: continue
        lon, lat = tm2(x, y)
        if not (118 < lon < 122.2 and 21.8 < lat < 26.5): continue
        out.append({'n': r['淨水場名稱'].strip(), 'r': r['區處別'].strip(), 'p': [round(lon, 5), round(lat, 5)], 'area': r['主要供水轄區'].strip(), 'src': r['原水來源'].strip()})
    json.dump({'source': '台灣自來水公司 淨水場位置及供水轄區資訊（data.gov.tw 36602）', 'plants': out}, open(f'{OUT}/plants.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('plants', len(out))

def reservoirs():
    meta = json.loads(get('https://data.gov.tw/api/v2/rest/dataset/32726'))['result']
    url = next(r['resourceDownloadUrl'] for r in meta['distribution'] if 'JSON' in (r.get('resourceFormat') or '').upper() or 'json' in r['resourceDownloadUrl'].lower())
    rows = json.loads(get(url.replace(' ', '%20')).decode('utf-8-sig'))
    if isinstance(rows, dict): rows = next(v for v in rows.values() if isinstance(v, list))
    print('32726 fields', list(rows[0].keys()))
    # OSM 水庫（名稱→中心點）
    q = '[out:json][timeout:180][bbox:21.8,118.1,26.5,122.2];(nwr["natural"="water"]["water"="reservoir"]["name"];nwr["landuse"="reservoir"]["name"];);out center tags;'
    # Overpass 會擋瀏覽器樣式的 User-Agent（406）→ 用專案名稱
    oh = {'User-Agent': 'taiwan-grid-flow/1.0 (https://github.com/willy110611-collab/taiwan-grid-flow)', 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}
    osm, err = None, None
    for host in ['https://overpass-api.de', 'https://overpass.private.coffee', 'https://maps.mail.ru/osm/tools/overpass', 'https://overpass-api.de']:
        try:
            osm = json.loads(urllib.request.urlopen(urllib.request.Request(f'{host}/api/interpreter', data=('data=' + urllib.parse.quote(q)).encode(), headers=oh), timeout=240).read()); break
        except Exception as e: err = e; print('overpass', host, repr(e)); __import__('time').sleep(15)
    if osm is None: raise err
    named = collections.defaultdict(list)
    for e in osm['elements']:
        c = e.get('center') or {'lat': e.get('lat'), 'lon': e.get('lon')}
        if c.get('lat'): named[re.sub(r'\s', '', e['tags']['name'])].append([round(c['lon'], 5), round(c['lat'], 5)])
    pick = lambda r, *ks: next((r[k] for k in ks if k in r and r[k] not in (None, '')), None)
    latest = {}
    for r in rows:
        rid = str(pick(r, 'ReservoirIdentifier', 'reservoiridentifier', '水庫代碼') or '')
        yr = str(pick(r, 'Year', 'year', '年度', '民國年') or '').zfill(4)
        if rid and (rid not in latest or yr > latest[rid][0]): latest[rid] = (yr, r)
    out, miss = [], []
    for rid, (yr, r) in latest.items():
        name = re.sub(r'\s', '', str(pick(r, 'ReservoirName', 'reservoirname', '水庫名稱') or ''))
        cap = pick(r, 'CurruntEffectiveCapacity', 'CurrentEffectiveCapacity', 'currunteffectivecapacity', '目前有效容量', '設計有效容量')  # 目前沒填（例如翡翠）用設計值
        try: cap = float(cap)
        except (TypeError, ValueError): cap = None
        bare = name.replace('水庫', '')
        cands = named.get(name) or named.get(bare) or named.get(bare + '水庫') or next((v for k, v in named.items() if name and (k.startswith(name.replace('水庫', '')) and '水庫' in k)), None)
        if not cands: miss.append(name); continue
        out.append({'id': rid, 'n': name, 'p': cands[0], 'cap': cap, 'area': str(pick(r, 'Area', 'area', '地區別') or ''), 'river': str(pick(r, 'RiverName', 'rivername', '河川名稱') or '')})
    json.dump({'source': '經濟部水利署 水庫基本資料（data.gov.tw 32726）；位置：OpenStreetMap 水庫範圍中心（ODbL）', 'reservoirs': out, 'unmatched': miss},
              open(f'{OUT}/reservoirs.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('reservoirs', len(out), 'unmatched', len(miss), miss[:30])

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for job in sys.argv[1:] or ['plants', 'reservoirs', 'taipei']:
        try: globals()[job]()
        except Exception as e: print('FAIL', job, repr(e))
