# Path Discovery Engine — määrittely (PIATLAS-PATH-1.0.0)

Path Discovery etsii piin desimaaleista laskettavia reittejä käyttäjän lähtötilan ja tavoitetilan
tunnisteiden välille. Se rakentuu nykyisen sovelluksen päälle: osumat (`src/core/matrix/hits.ts`),
kartoitukset (`mapIndex`, `vogel`), Fibonacci-luvut, 369-määritelmät (`src/core/matrix/ops369.ts`), reittitestin
nollamalli ja lukitus (`src/state/matrix.ts`). Piin koordinaatteja tai koodaussääntöjä ei muuteta.

Versiot: haku `PIATLAS-PATH-1.0.0`, Path Score `PIATLAS-PATHSCORE-1.0.0`, sokkotesti `PIATLAS-BLIND-1.0.0`.
Ydinkirjasto on `src/core/path/`, tila `src/state/path.ts` ja `path-actions.ts`, käyttöliittymä
`src/ui/matrix/PathPage.tsx`, `PathResult.tsx`, `PathMap.tsx`, `BlindPage.tsx` ja `path-bits.tsx` (luku 8).

## 0. Tutkimuskysymys ja mitä tulos voi tarkoittaa

Lähtöhypoteesi: pii saattaa sisältää kaikki äärelliset numerosarjat ja siten kaikki numeroiksi koodattavat
elämäntarinat. Tämä on testattava hypoteesi, ei oletus ennustuskyvystä.

Jos pii sisältää kaikki äärelliset sarjat (piin normaaliutta ei ole todistettu), se sisältää yhtä lailla kaikki
väärät tarinat. Siksi **pelkkä reitin löytyminen ei ole näyttöä**. Tulos voi olla kiinnostava vain kahdella
tavalla:

1. **Harvinaisuus**: sama haku samoilla lukituilla parametreilla tuottaa yhtä hyvän reitin harvoin
   satunnaisaineistossa (Path Score, kohta 6).
2. **Sokkotesti**: menetelmä tunnistaa piilotetun todellisen tapahtuman useammin kuin satunnainen valinta ja
   useammin kuin sama algoritmi ilman piin numeroita (kohta 7).

Jokaisen tuloksen kohdalla näytetään erikseen:

| Osa | Sisältö |
| --- | --- |
| **Laskettu piin rakenne** | reitin osumat, alkuperäiset numerot, indeksit, säännöt, tarkistukset |
| **Käyttäjän symbolinen tulkinta** | lähtö- ja tavoitetilan tekstit, nimien ja tapahtumien merkitys |
| **Testattu ennustetulos** | sokkotestin tulos tälle menetelmälle ja näille parametreille, tai ”ei testattu” |

Moottori ei koskaan täydennä puuttuvia reitin vaiheita yleisillä neuvoilla tai tekstillä. Jos aineistosta ei
löydy reittiä, se sanotaan, ja syy näytetään.

## 1. Syöte

- **Lähtötila** ja **tavoitetila**: vapaa teksti (symbolinen tulkinta) + tunnisteet.
- **Tunnisteet** (`PathIdentifier`): nimi tai sana (T9, suomalainen translitterointi Å,Ä → A ja Ö → O),
  numerojono (raaka), päivämäärä (valittu muoto, oletus DDMMYYYY), tarinan henkilö (nimen T9) tai tapahtuma
  (päivämäärän koodi). Tekstistä poimitaan automaattisesti vain tarinassa tunnetut nimet (lähtötunnisteet ja
  henkilöt) täsmä- tai alkuosavastaavuudella (”Hannan” → HANNA). Tuntemattomat sanat ohitetaan. Käyttäjä
  hyväksyy ja täydentää listan.
- **Tunnetut** henkilöt, tapahtumat ja numerosarjat: sallitut välisolmut (sanasto).
- **Aikarajaus**: rajaa, mitkä tapahtumat otetaan tunnisteiksi. Piin indeksillä ei ole kalenteriaikaa, joten
  aikarajaus ei vaikuta piin indekseihin.

Jos lähtö- ja tavoitetila koodautuvat samaksi tunnistejoukoksi (esim. ”Matti ja Hanna eivät ole yhdessä” →
”Matti ja Hanna ovat yhdessä”), haku ei voi erottaa niitä. Silloin näytetään varoitus ja pyydetään
tavoitteelle oma tunniste (esim. sana tai päivämäärä).

## 2. Solmut ja sanasto

Solmu on todennettu osuma `(koodi, n)`: `digits[n − 1 … n + L − 2] === koodi`. Sanasto `V` = lähtö-, tavoite- ja
tunnettujen tunnisteiden koodit. Vain sanaston koodien osumat ovat solmuja. Koodi hylätään solmuna syyn kanssa,
jos se on lyhyempi kuin `minCodeLength` (oletus 3; lyhyellä koodilla on 1M-aineistossa kymmeniätuhansia
osumia), jos sillä ei ole osumia tai jos osumia on enemmän kuin `maxHitsPerCode` (oletus 5 000). Esimerkiksi
7-numeroisella koodilla on 1M-aineistossa odotusarvoisesti 0,1 osumaa, joten sana YHDESSÄ (9433772) hylätään
syyllä ”ei osumia”.

Symboliset linkit (tarinan suhteet, tulkinnat, tapahtumien käyttäjälinkit) **eivät ole särmiä**. Ne eivät voi
toimia oikoteinä. Ne näkyvät vain solmujen nimilappuina.

## 3. Säännöt (särmät)

Jokaisella säännöllä on tunnus, kaava, kerros ja suunta-alue. Suunta 234 = lähtöpuolen haku, 432 =
tavoitepuolen haku. Indeksisuunta, geometrinen suunta ja elämäntarinan kronologia pidetään erillään:
elämäntarinan kronologia ei ole sääntö lainkaan.

| Tunnus | Kerros · alue | 234 (eteenpäin) | 432 (taaksepäin) |
| --- | --- | --- | --- |
| `indeksi-seuraava` | matemaattinen · π-indeksi | jokaisen sanastokoodin lähin osuma n′ > n, n′ − n ≤ W | lähin osuma n′ < n, n − n′ ≤ W |
| `fib-naapuri` | geometrinen · spiraali | n + F_k, k ∈ [kMin, kMax], jos kohdasta alkaa sanastokoodin osuma | n − F_k |
| `oktaedri-lähin` | geometrinen · oktaedri | `nearestK` lähintä sanastokoodin osumaa, chord ≤ `chordMax` (suuntaa ei ole) | sama |
| `369-siirtymä` | matemaattinen · π-indeksi | n + k, k ∈ {3, 6, 9} | n − k |
| `369-fib3k` | geometrinen · spiraali | n + F_{3k}, k = 1…7 | n − F_{3k} |
| `369-mod9` | matemaattinen · π-indeksi | lähin osuma n′ > n, (n′ − n) ≡ 0 (mod 9), n′ − n ≤ 9W | vastaavasti n′ < n |

369-säännöt (`STEPS_369`, `FIB_3K` ja mod 9 samoina kuin `ops369.ts`) ovat käytössä vain, kun käyttäjä aktivoi
369-avaimen (`use369`). Jokainen 369-askel lasketaan **muunnokseksi**.

432-säännöt ovat 234-sääntöjen **peilikuvia**, eivät välttämättä niiden käänteisiä särmiä. Käänteisiä
(u → v 234:ssä ⇔ v → u 432:ssa) ovat vain `fib-naapuri`, `369-siirtymä` ja `369-fib3k`. `indeksi-seuraava`
ei ole: ”y on x:n lähin seuraava osuma” ei tarkoita, että x on y:n lähin edellinen osuma. Samoin
`oktaedri-lähin` (k lähintä ei ole symmetrinen) ja `369-mod9`.

## 4. Haku

Haku on nimiöhaku (label-setting) kummallekin puolelle (`src/core/path/search.ts`). Nimiön kustannus on
(hinta, muunnokset, Σ|Δn|) leksikografisesti; hinta = askeleet + 369-askeleet (perusaskel 1, 369-askel 1 + 1).
Samassa solmussa säilytetään nimiöt, joita mikään toinen ei dominoi (pienempi tai yhtä suuri kustannus ja
enintään yhtä monta askelta), jotta `maxEdges`-raja ei hävitä halvempia reittejä. Lähtö- ja tavoitesolmut ovat
lähdenimiöitä (hinta 0).

- **234**: monilähteinen haku kaikista lähtösolmuista eteenpäin. Vain lähtöpuoli laajenee; reitti päättyy
  tavoitesolmuun. Kustakin tavoitesolmusta pidetään paras reitti.
- **432**: monilähteinen haku kaikista tavoitesolmuista taaksepäin 432-säännöillä. Näyttää, mistä
  tavoitesolmuun voidaan päätyä. Reitti käännetään luettavaksi lähtö → tavoite. Kustakin lähtösolmusta pidetään
  paras reitti.
- **Kaksisuuntainen**: molemmat puolet laajenevat. Kun lähtö- ja tavoitepuolen nimiöt kohtaavat samassa
  solmussa, reitti = lähtöpuolen polku + tavoitepuolen polku käännettynä (`meetIndex` = kohtaamissolmu).
  Tavoitepuolen askeleet säilyttävät 432-sääntönsä kuvauksen (esim. ”293 979 = lähin 42662-osuma < 294 284”).
  Laajennusjärjestys: pienempi rintama ensin. Kun säännöt eivät ole käänteisiä, alaraja nousee vain pienemmän
  rintamahinnan puolelta, joten se laajenee ensin (tasatilanteessa pienempi rintama, sitten 234).
- **Kelvollinen reitti**: 1 ≤ askeleet ≤ `maxEdges`, ei toistuvia solmuja, eikä lähtösolmu ole sama kuin
  tavoitesolmu (silmukka).
- **Pysäytys**: `k = maxRoutes` parasta reittiä on vahvistettu, kun k:nnen reitin hinta < LB, missä LB on
  alaraja jokaiselle vielä löytymättömälle reitille (top = rintaman pienin hinta):
  - 234: LB = top₂₃₄ + 1; 432: LB = top₄₃₂ + 1
  - kaksisuuntainen, kun kaikki käytössä olevat säännöt ovat käänteisiä (`fib-naapuri`, `369-siirtymä`,
    `369-fib3k`): LB = top₂₃₄ + top₄₃₂ + 1 (tavallinen kaksisuuntainen ehto)
  - kaksisuuntainen muuten, myös oletussäännöillä (`indeksi-seuraava` ja `oktaedri-lähin` ovat peilisääntöjä):
    LB = min(top₂₃₄, top₄₃₂) + 1. Tavallinen ehto voisi pysäyttää ennen parasta reittiä, koska peilisäännöillä
    kohtaaminen ei ole symmetrinen. Tämä ehto pitää tuloksen tarkkana. Yksikkötesti täydellä aineistolla
    tarkistaa kaikilla tiloilla (myös 369), ettei kaksisuuntaisen haun paras reitti ole huonompi kuin 234:n tai
    432:n.
- **Budjetti**: enintään `budget` laajennettua solmua kummallekin puolelle ja `maxEdges` askelta reitissä.
  Jos budjetti loppuu, se kerrotaan, ja löydetyt reitit ovat parhaat siihen mennessä löydetyt.
- **Ehdokkaat**: enintään `maxRoutes` reittiä, järjestys (kustannus, muunnokset, Σ|Δn|, solmuavaimet).
  Deterministinen: sama syöte ja parametrit → sama tulos ja sama tulostiiviste (FNV-1a reittien avaimista,
  kustannuksista ja askelten säännöistä ja puolista).
- **Tarkistus**: jokaisen askeleen molemmat solmut tarkistetaan lähdeaineistosta (`verifyHit`), ja askel näyttää
  instansioidun kaavan, Δn:n, haarautumisen (naapurien määrä) ja alkuperäiset numerot.
- **Saavutetut solmut** (234 ja 432): enintään 200 solmua syvyyden mukaan (syvyys, sääntö, jolla solmu
  saavutettiin) sekä puolen tilastot (laajennukset, saavutetut solmut, syvin taso, budjetti).
- **Epäonnistuminen**: palautetaan syyt, esim. ”koodilla ei osumia”, ”koodi liian lyhyt”, ”lähtö- ja
  tavoitejoukko samat”, ”tavoitejoukossa ei ole yhtään käyttökelpoista koodia”, ”budjetti loppui”, ”rintamat
  eivät kohdanneet `maxEdges` askeleen sisällä” (saavutettujen solmujen ja laajennusten määrät mukana) ja
  ”rintama tyhjeni N askeleen jälkeen”.

## 5. Parametrien lukitus

Kysely kanonisoidaan (`canonicalQuery`): versio, hakutila, parametrit (käytössä olevat säännöt
`activeRules`-järjestyksessä) ja koodit rooleittain aikarajauksen jälkeen. Käyttäjän tekstit ja tunnisteiden
nimet kirjataan erilliseen kenttään ”symbolinen”: ne tallentuvat tiivisteeseen, mutta eivät vaikuta hakuun.

- **SHA-256 ennen moottorikutsua.** Tilakerros laskee tiivisteen (`sha256Hex`) ja kirjaa ajon tilaan
  ”käynnissä” ennen kuin moottori saa kyselyn. Tuloksessa näkyy, täsmäsikö moottorin kanoninen kysely
  lukittuun (”moottorin kanoninen kysely täsmää ✓”). Satunnaisvertailun tiiviste lasketaan haun tiivisteestä
  ja R:stä, jonoista ja siemenestä (`canonicalNull`), sokkotestin kohteista ja parametreista (`canonicalBlind`).
- **Eksploratiivisuus.** Kyselyn identiteetti on lähtö- ja tavoitekoodit. Asetukset ovat parametrit ja
  tunnetut välisolmut; hakutila (234/432/kaksisuuntainen) ei ole asetus, mutta jokainen ajo lasketaan.
  Kyselyn ensimmäinen nähty tulos lukitsee siihen mennessä valitut asetukset (myös keskeytettyjen ajojen).
  Myöhempi ajo samalle kyselylle muilla asetuksilla merkitään ”eksploratiivinen (parametrit muutettu tulosten
  näkemisen jälkeen)”, ja muuttuneet asetukset luetellaan. 369-avain muuttaa parametria `use369`, joten
  369-ajo nähdyn tuloksen jälkeen on eksploratiivinen; alkuperäisillä asetuksilla ajettu uusi haku ei ole.
  Satunnaisvertailun asetukset ovat R, jonot ja siemen, ja eksploratiivisen haun vertailu on itsekin
  eksploratiivinen. Sokkotestin identiteetti on kohdejoukko, asetukset harhauttimet, siemen, jonot ja
  polkuhaun parametrit.
- **Monivertailu.** Polkuhaut, satunnaisvertailut ja sokkotestit lasketaan omilla laskureillaan (myös
  keskeytetyt ja epäonnistuneet), ja huomautus näyttää m:n ja odotetun m·α:n kuten Reitit-sivu. BH-q
  lasketaan vertailujen ja sokkotestien p-arvoista m:llä (puuttuvat p-arvot oletetaan ykkösiksi).

## 6. Path Score (PIATLAS-PATHSCORE-1.0.0)

Path Score **ei ole tulevaisuuden toteutumistodennäköisyys**. Se kuvaa reitin rakennetta ja harvinaisuutta tässä
aineistossa verrattuna satunnaisaineistoon samoilla lukituilla parametreilla. Vastuuvapauslauseke
(`PATHSCORE_DISCLAIMER`) näytetään aina pistemäärän vieressä.

| Osa | Määritelmä |
| --- | --- |
| Harvinaisuus | Jokaiselle nollamallille p = (1 + #{replikaatit, joissa paras reitti on yhtä hyvä tai parempi kuin havaittu}) / (R + 1), Wilsonin 95 %:n väli osuudelle. Pistemäärä min(1, −log10 p / log10(R + 1)), jossa **p on suurin ajettujen mallien p-arvoista ja R suurin replikaattimäärä**. Tulos on siis enintään kunkin mallin oma pistemäärä (varovainen). Harvinaisuus koskee kyselyn parasta reittiä, joten se on sama kaikille saman haun reiteille. |
| Pituus | 1 / askeleet |
| Haarautuminen | b = askelten keskimääräinen naapurimäärä; 1 / (1 + log2 b) |
| Muunnokset | 1 / (1 + 369-askeleet) |
| Rakenne | geometristen ja matemaattisten askelten osuudet (kuvaileva, ei pisteytetä) |
| Toistettavuus | π-haku ajetaan kahdesti (codeHits-välimuisti ja erillinen findAll-instanssi): sama tulostiiviste, sama paras reitti kuin havaittu ja sama annettu tiiviste (kyllä/ei) |

Kokonaispistemäärä = round(100 · (0,6 · harvinaisuus + 0,15 · pituus + 0,15 · haarautuminen + 0,1 · muunnokset)).
**Kokonaispistemäärää ei anneta (null, ”ei pistemäärää”)**, jos satunnaisvertailua ei ole ajettu (myös R = 0
ja jonot 0) tai jos toistettavuus epäonnistui tai sitä ei ole tarkistettu.

Reittien vertailu (`compareCost`): (askeleet + muunnokset, muunnokset, Σ|Δn|) leksikografisesti, ja reitin
puuttuminen on huonoin. Jos π-aineistosta ei löytynyt reittiä, jokainen replikaatti on yhtä hyvä tai parempi,
joten p = 1, ja replikaatit ilman reittiä kerrotaan erikseen (”Ei reittiä”).

Nollamallit ajavat täsmälleen saman haun samalla kyselyllä, parametreilla ja hakutilalla; vain osumalähde vaihtuu:

- **Tasajakauma**: jokaisen sanastokoodin todellinen osumamäärä säilyy, ja paikat arvotaan alkukohtiin
  1 … N − L + 1 ilman toistoja koodin sisällä. Replikaatti r käyttää siementä s + r. Koodit sijoitetaan
  toisistaan riippumatta, joten eri koodien osumat voivat osua päällekkäin tai niin lähelle toisiaan, ettei
  mikään todellinen numerojono voisi sisältää niitä. Tämä tekee nollamallista reittejä hieman suosivamman,
  joten p on pikemminkin liian suuri kuin liian pieni (varovainen). Lähteessä ei ole numeroita, joten
  replikaatin askelia ei tarkisteta (”ei numeroita (nollamalli)”).
- **Satunnaisjono**: siemenellinen 0–9-jono, pituus N, jono j siemenellä s + 10 000 + j. Osumamäärät
  vaihtelevat kuten satunnaisaineistossa, ja osumat voidaan tarkistaa jonosta.

Kalibrointi (yksikkötesti täydellä aineistolla): kun ”havaittu” aineisto arvotaan itse tasajakaumasta todellisilla
osumamäärillä, p ≤ 0,05 -tuloksia on 15 kokeilussa alle 25 % ja p:n keskiarvo yli 0,3.

## 7. Blind Discovery (PIATLAS-BLIND-1.0.0)

Sokkotesti mittaa, tunnistaako menetelmä piilotetun todellisen tiedon (`src/core/path/blind.ts`).

**Kohteet**

- **Polun askeleet** (`blindItemsFromStory`): yksi kohde jokaista tarinan polun askelta kohden. Ryhmä = polun
  tunnus, koodi = nimen T9. Vuotoavaimet: `nimi:<nimi>`, `koodi:<koodi>` ja `henkilö:<id>`.
- **Tapahtumat** (`blindItemsFromEvents`): vain tapahtumat, joilla on kelvollinen ISO-päivämäärä. Ryhmä
  `tapahtumat`, koodi = päivämäärä valitussa muodossa. Vuotoavaimet: `tapahtuma:<id>`, `päivä:<iso>`,
  `koodi:<koodi>` ja jokaiselle linkitetylle osumalle `kohta:<n>`.

**Kierros** (leave-one-out): yksi kohde piilotetaan. Konteksti = saman ryhmän muut kohteet vuotojen poiston
jälkeen. Ehdokkaat = oikea vastaus + D harhautinta, joilla on **sama koodin pituus**, koska pituus määrää
osumamäärän. Nimien harhauttimet arvotaan kiinteästä suomalaisten etunimien listasta (`decoy-names.ts`),
päivämäärien harhauttimet tasajakautuneesti ryhmän päivämäärien väliltä ± 365 päivää. Siemen ja D lukitaan
ennen ajoa.

**Vuotojen esto ja poissulkemiset**

- Kontekstista poistetaan kohde, jolla on sama koodi kuin piilotetulla, jonka koodi kuuluu piilotetun
  vuotoavaimiin tai jolla on yhteinen vuotoavain piilotetun kanssa. Poistot ja syyt kirjataan kierrokseen.
- Sanasto = vain kontekstin koodit (lähtö) + testattava ehdokas (tavoite). Tarina, suhteet, tulkinnat ja
  tapahtumat eivät koskaan välity hakuun (`searchPaths` saa `ctx = null`).
- Vuotoavaimet `kohta:<n>` (piilotetun tapahtuman linkitetyt osumat) poistavat kierroksen osumalähteestä
  kaikilta koodeilta kyseisestä kohdasta alkavat osumat.
- Harhautin ei ole koskaan minkään kohteen koodi tai päivämäärä (myös toisten ryhmien), tarinan nimen T9-koodi
  (lähtötunnisteet, henkilöt, polkujen askeleet) eikä todellisen tapahtuman päivämäärä tai sen koodi.
- Ehdokkaiden järjestys sekoitetaan siemenellä. Tasapelit ratkaistaan siemenellisellä permutaatiolla, joka
  arvotaan ennen hakua eikä riipu ehdokkaiden järjestyksestä eikä siitä, mikä ehdokas on oikea; jokaisella
  lähteellä (π ja kukin satunnaisjono) on oma permutaationsa.

**Ohitussäännöt** (kohde ohitetaan syyn kanssa, eikä hiljaa): tunnus jo käytössä; kohde eri tyyppiä kuin
testi; koodi puuttuu (nimeä ei voi koodata T9:llä); tapahtumalla ei kelvollista päivämäärää tai koodi ei vastaa
päivämäärää valitussa muodossa; kontekstia ei jää vuotojen poiston jälkeen (ryhmässä tarvitaan vähintään kaksi
kohdetta); koodi lyhyempi kuin `minCodeLength`; kaikki kontekstin koodit lyhyempiä kuin `minCodeLength`;
harhauttimia ei löydy. Jos harhauttimia löytyy vähemmän kuin D, kierroksella on vähemmän ehdokkaita, se
kerrotaan, ja sattuman odotus lasketaan todellisella ehdokasmäärällä.

**Pisteytys**: jokaiselle ehdokkaalle ajetaan sama kaksisuuntainen haku konteksti → ehdokas. Ehdokkaat
järjestetään parhaan reitin mukaan (askeleet + muunnokset, muunnokset, Σ|Δn|; ei reittiä = huonoin). Vain
lähdeaineistosta tarkistettu reitti kelpaa (tarkistamaton kirjattaisiin huomautukseksi). Tulos = oikean
vastauksen sijoitus.

**Vertailu**

1. Satunnainen valinta: sijoitus tasajakautunut 1 … D + 1, osumatarkkuus 1/(D + 1). p = P(keskisijoitus ≤
   havaittu), kun sijoitukset ovat riippumattomia ja tasajakautuneita: tarkka konvoluutio (käytännössä aina) tai
   siemenellinen Monte Carlo (≥ 20 000 arvontaa), jos työmäärä F · Σ ehdokkaat ylittää 5 · 10⁷.
2. Sama algoritmi ilman piin numeroita: siemenelliset satunnaiset 0–9-jonot samalla pituudella N (jonon i
   siemen johdetaan sokkotestin siemenestä ja i:stä).

**Johtopäätössäännöt** (`verdictText`, α = 0,05). Ennustuskykyä ei väitetä koskaan, ellei molemmat ehdot täyty:

| Ehto | Johtopäätös |
| --- | --- |
| yhtään kierrosta ei voitu ajaa | ”Ei näyttöä: yhtään sokkotestin kierrosta ei voitu ajaa” |
| p ≤ α **ja** π:n keskisijoitus parempi kuin satunnaisjonojen | ”Sattumaa parempi tässä sokkotestissä” + rajaus: koskee vain näitä kohteita, aineistoa ja lukittuja parametreja; ei ennuste yksittäisestä tapahtumasta |
| p ≤ α, mutta satunnaisjonot yhtä hyviä tai parempia tai niitä ei ajettu | ”Ei näyttöä piin osuudesta” |
| muuten | ”Ei näyttöä: menetelmä ei tunnistanut piilotettuja kohteita sattumaa paremmin” |

Jos polkujen hypoteesia ei ole lukittu ennen löydöstä (esim. tehtävänannon polut A ja B), tulokseen liitetään
varaus: kohteet on voitu valita π-sijaintien perusteella, joten sokkotesti ei ole niiden osalta riippumaton.

**Tulos**: jokaisen kierroksen oikea/väärä ja sijoitus, paras ehdokas, satunnaisjonojen sijoitukset,
top-1-osuus, keskisijoitus, p-arvo ja menetelmä, vertailu piittömään malliin, ohitetut kohteet syineen,
kanoninen kuvaus ja tulostiiviste. Kaikki ajot tallennetaan, myös epäonnistuneet ja keskeytetyt.

Vain sokkotestin tulos voi tukea väitettä, että menetelmä tunnistaa todellisia tapahtumia. Jos se on
sattuman tasolla, mikään yksittäinen löydetty reitti ei ole ennuste.

## 8. Käyttöliittymä

Path Discovery on Matriisi-välilehden kaksi alasivua: **Etsi reitti** ja **Sokkotesti**. Molemmat toimivat
puhelimessa (412 ja 360 px), ja kaikki tieto pysyy laitteella (`localStorage`; ei verkkopyyntöjä).

**Etsi reitti**

1. Kirjoita lähtötila ja tavoitetila omin sanoin ja paina **Poimi tunnetut nimet**. Jokainen tunniste näkyy
   sirulla koodeineen ja koodaussääntöineen (esim. HANNA 42662, T9: H=4 A=2 …). Jos tilat koodautuvat samaksi
   joukoksi, näkyy varoitus. **Lisää tunniste** lisää sanan, nimen, numerojonon, päivämäärän, henkilön tai
   tapahtuman; koodi näkyy ennen lisäystä. Tunnetut välisolmut ja aikarajaus ovat omissa lohkoissaan.
2. **Parametrit** (avattava): säännöt, use369 ja numerokentät tarkistuksineen, Palauta oletukset ja koko
   SHA-256, joka lukitaan ajon alussa. Rivi ”Seuraava ajo” kertoo etukäteen, merkitäänkö ajo eksploratiiviseksi.
3. Haku: **432 · etsi tavoitteesta taaksepäin**, **234 · etsi lähdöstä eteenpäin**, **Kaksisuuntainen haku** ja
   erillinen **369 · tutki vaihtoehtoiset reitit** (sama kysely kaksisuuntaisena 369-säännöillä; korostuu, jos
   edellinen haku ei löytänyt reittiä). Käynnissä oleva työ näyttää etenemisen ja Keskeytä-painikkeen.
4. Tulos: tila (”Reitti löytyi” / ”Reittiä ei löytynyt” / ”Haku epäonnistui”), hakutila, lukitus (tiiviste,
   aika, täsmäys, tulostiiviste) ja ”parametrit lukittu ennen tuloksia” tai eksploratiivinen merkintä syineen.
   Syyt ja hylätyt koodit näytetään aina, kun niitä on. Sen jälkeen **kolmen osan erottelu**, reittikartta
   (askeleet vasemmalta oikealle, särmän väri = kerros, 369 katkoviivalla, 234 ▸ / ◂ 432, kohtaaminen),
   jäljitys askel askeleelta (kaava, n, numerot ✓, sääntö, kerros, puoli, Δn, haarautuminen, **Avaa
   matriisissa**, **Näytä spiraalissa**, **Näytä 3D:ssä**), satunnaisvertailu ja Path Score, sanasto
   osumamäärineen ja 234/432-hauissa saavutetut solmut.
5. **Satunnaisvertailu**: R (50 / 200 / 1 000), satunnaisjonot (0 / 5 / 20) ja siemen. Mallit näkyvät taulukossa
   (p, yhtä hyvät tai paremmat, ei reittiä, Wilsonin väli, siemenet), toistettavuus ✓/✗ ja jokaisen reitin
   Path Score -kortti vastuuvapauslausekkeineen. Harvinaisuuden kohdalla näkyy, mistä p:stä ja R:stä se
   laskettiin.
6. **Tallenna tulos** tallentaa kyselyn, tunnisteet, parametrit, tiivisteen, reitit, Path Scoret, vertailut ja
   viittauksen uusimpaan sokkotestiin samoilla parametreilla. **Avaa** palauttaa lomakkeen ja tuloksen.
   **Ajohistoria** listaa jokaisen haun ja vertailun tiivisteineen, BH-q:ineen ja lukitustietoineen, ja
   monivertailun huomautus laskee kaikki ajot.

**Sokkotesti**: kohdetyyppi (polun askeleet / tapahtumat), harhauttimet D (oletus 9), siemen, satunnaisjonot
(0 / 2 / 5 / 10, oletus 2) ja tapahtumille päivämäärän muoto. Lomake kertoo käyttökelpoisten kohteiden määrän
ja ohitettavat syineen, näyttää polkuhaun parametrit (samat kuin Etsi reitti -sivulla; haku on aina
kaksisuuntainen) ja SHA-256:n ennen ajoa. Tulos: johtopäätös, kierrokset (oikein/väärin, sijoitus, konteksti,
paras ehdokas, satunnaisjonojen sijoitukset), yhteenveto, huomautukset ja historia monivertailuineen.

**Testattu ennustetulos** Etsi reitti -tuloksessa näyttää uusimman valmiin sokkotestin, jonka polkuhaun
parametrit ovat samat kuin tuloksen, tai ”Ei testattu”. Se kuvaa menetelmää, ei yksittäistä reittiä.

**Reitti kartoilla**: Näytä spiraalissa / 3D:ssä piirtää reitin kultaisena murtoviivana ja numeroituina
merkkeinä 1…k (spiraali, 8 kolmiota, avattu verkko ja 3D) ja näyttää selitelapun ”Reitti: …” sulkemispainikkeineen.
Reitin aikana valitun osuman merkkipolun numerot jätetään pois, jotta ne eivät sekoitu reitin numeroihin.

**Yksi moottorityö kerrallaan**: polkuhaku, satunnaisvertailu, sokkotesti ja reittitesti estävät toisensa;
hylätty työ saa ilmoituksen ja virherivin. Ilman Web Workeria satunnaisvertailu ja sokkotesti keskeytyvät
replikaattien välissä, yksittäinen polkuhaku ei.

**Kirjaus**: jokainen toiminto kirjataan matriisin lokiin lajeilla `polkuhaku` ja `sokkotesti`; haut,
369-laajennus, vertailut, sokkotestit ja tallennukset myös yhteiseen muutoshistoriaan. Raportin (Testit →
Vienti) osio `pathDiscovery` sisältää versiot, Path Scoren määritelmän ja vastuuvapauslausekkeen, lomakkeen,
ajot BH-q:ineen, tallennetut tulokset, sokkotestit ja monivertailun luvut. Laitteelle tallentuu enintään 300
ajoa, 100 tallennettua tulosta ja 200 sokkotestiä; laskurit ovat rajaamattomia.

## 9. Ensimmäiset tulokset täydellä aineistolla

Aineisto `pi_digits_1m.txt` (N = 1 000 000), oletusparametrit (`indeksi-seuraava`, `fib-naapuri`,
`oktaedri-lähin`, W = 2 000, F2–F25, K = 3, chord ≤ 0,01, enintään 6 askelta), kaksisuuntainen haku, mitattu
2026-10-18 ydinkirjaston funktioilla (`searchPaths`, `runPathNull`, `runBlindTest`) samoilla asetuksilla kuin
käyttöliittymässä.

**Siemenkysely {MATTI, HANNA} → {SALLA, IDA}.** Osumia MATTI 9, HANNA 7, SALLA 6, IDA 1 054. Paras reitti
MATTI 62884 @858 260 → IDA 432 @858 511 (1 askel, indeksi-seuraava, Σ|Δn| = 251), viisi reittiä.

| Satunnaisvertailu (siemen 20261018) | Tasajakauma | Satunnaisjonot | Path Score (reitti 1) |
| --- | --- | --- | --- |
| R = 50, 5 jonoa | 49/50 yhtä hyvä tai parempi, p = 0,980 | 5/5, p = 1,000 | 32 / 100 (harvinaisuus 0) |
| R = 1 000, 20 jonoa | 983/1 000, p = 0,983 | 20/20, p = 1,000 | 32 / 100 (harvinaisuus 0) |

Reitti ei ole harvinainen: koodilla 432 on noin 1 000 osumaa, joten lähes mistä tahansa aineistosta löytyy
yhden askeleen reitti W = 2 000:n sisällä. Siemenellä 20261017 (R = 50, 5 jonoa) p on sama 0,980 / 1,000.

**E2e-kysely {MATTI, HANNA} → {YHDESSÄ, KOTI}** (”Matti ja Hanna eivät ole parisuhteessa” → ”Matti ja Hanna
ovat palanneet yhteen”). YHDESSÄ 9433772 hylätään (0 osumaa). Pelkällä YHDESSÄ-tavoitteella reittiä ei ole, ja
syy näytetään. KOTI 5684 (114 osumaa): paras reitti HANNA 42662 @293 979 → KOTI 5684 @294 284 (1 askel,
Σ|Δn| = 305), kolme reittiä, joista yksi kulkee kohtaamissolmun kautta (MATTI → HANNA → KOTI, 234 + 432).
Satunnaisvertailu R = 50, 5 jonoa, siemen 20261018: tasajakauma 16/50 (yksi ilman reittiä), p = 0,333;
satunnaisjonot 3/5, p = 0,667 → harvinaisuus lasketaan p:stä 0,667 ja R:stä 50 = 0,10, Path Score 46, 39 ja 31.
R = 1 000, 20 jonoa: p = 0,393 ja 0,571. Ei harvinainen.

**Sokkotesti, siemen-tarinan polut** (polku A: MATTI, HANNA, MAX; polku B: HANNA, SALLA, IDA; 6 kohdetta), D = 9,
2 satunnaisjonoa, oletusparametrit:

| Siemen | Oikein ensimmäisenä | Keskisijoitus (odotus 5,50) | p vs. satunnainen valinta | Satunnaisjonot (keskisijoitus) | Johtopäätös |
| --- | --- | --- | --- | --- | --- |
| 20261018 (käyttöliittymän oletus) | 0/6 (odotus 0,60) | 6,33 | 0,778 (tarkka) | 4,42 | Ei näyttöä |
| 20261017 (yksikkötesti) | 0/6 | 5,67 | 0,582 (tarkka) | 5,08 | Ei näyttöä |

Siemenellä 20261018 kierrosten sijoitukset ovat MATTI 2, HANNA (A) 7, MAX 9, HANNA (B) 9, SALLA 4 ja IDA 7
(kymmenestä). Jokaisella ehdokkaalla on yhden askeleen reitti, koska MAX ja IDA ovat 3-numeroisia (~1 000
osumaa), joten järjestys ratkeaa Σ|Δn|:llä ja on sattuman tasolla. Polut A ja B ovat tehtävänannosta
(”löydön jälkeen”), joten tulokseen liitetään riippumattomuusvaraus. Johtopäätös: menetelmä ei tällä
aineistolla tunnista piilotettuja tarinan askeleita sattumaa paremmin, joten yksikään löydetty reitti ei ole
ennuste.
