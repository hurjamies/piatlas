# PI ATLAS: tekninen kuvaus

Versiotunnukset (näkyvät sovelluksessa ja jokaisessa raportissa): kartoitus `PIATLAS-MAP-1.0.0`, koodaukset
`PIATLAS-ENC-1.0.0`, tilastot `PIATLAS-MC-1.0.0`, avattu verkko `PIATLAS-NET-1.0.0`. Tarinamatriisi:
`PIATLAS-MATRIX-1.0.0`, 369-avausavain `PIATLAS-369-1.0.0`, hyppysäännöt `PIATLAS-JUMP-1.0.0` ja reittitesti
`PIATLAS-ROUTE-1.0.0` (ks. luku 9). Path Discovery: haku `PIATLAS-PATH-1.0.0`, Path Score `PIATLAS-PATHSCORE-1.0.0`
ja sokkotesti `PIATLAS-BLIND-1.0.0` (ks. luku 10). Jos jokin kaava muuttuu, tunnus vaihtuu, jotta vanhat tulokset
voidaan toistaa.

## 1. Indeksointi

- Aineisto alkaa piin ensimmäisestä desimaalista: `141592653589793…`. Etunumeroa 3 ja desimaalipistettä ei ole.
- Käyttäjälle näytetään **1-pohjainen** indeksi n: n = 1 on numero ”1”. Koodissa `digits[n − 1]`.
- Haku etsii vain **peräkkäisiä** desimaaleja `String.indexOf`-silmukalla. Seuraava haku alkaa kohdasta i + 1,
  joten päällekkäiset osumat lasketaan (`4444` löytyy jonosta `44444` kahdesti).
- Kokeellinen hyppypolku (n, n+F_k, n+2F_k, …) on erillinen tila. Sen osumat merkitään aina
  ”kokeellinen hyppypolku” eikä niitä sekoiteta peräkkäisiin osumiin.
- Odotettu osumamäärä tasajakautuneessa satunnaisjonossa on (N − L + 1) / 10^L. Esimerkiksi `432`: 1000,
  havaittu 1054. `62884`: 10, havaittu 9.

## 2. 3D-sijoitus oktaedrille (N-riippumaton)

```
gamma = π (3 − √5)                 kultainen kulma ≈ 2,39996 rad ≈ 137,508°
a     = √2 − 1
θ(n)  = n · gamma
z(n)  = 2 · fract(n · a + 0,5) − 1
u(n)  = ( √(1−z²) cos θ, √(1−z²) sin θ, z )      yksikköpallolla
p(n)  = u / (|uₓ| + |u_y| + |u_z|)               oktaedrin pinnalla |x|+|y|+|z| = 1
```

- `mapIndex(n)` ottaa vain yhden argumentin, joten aineiston koko ei voi vaikuttaa pisteeseen. Testi
  tarkistaa, että `mapIndex(858511)` pysyy bitilleen samana, kun aineisto kasvatetaan 1M:stä 10M:ään.
- Pari (θ/2π mod 1, z) on kaksiulotteinen Kronecker-jono askelin (2 − φ, √2 − 1). Koska 1, √5 ja √2 ovat
  rationaalisesti riippumattomia, pisteet tasoittuvat pallolle. Tasainen z antaa pallolla tasaisen pinta-alan
  (Arkhimedes). Projektio oktaedrille on radiaalinen, joten pisteet eivät ole oktaedrin pinta-alan suhteen
  tasaisia. Nollamalli käyttää samaa kartoitusta, joten tämä epätasaisuus on mukana myös vertailussa.
- **Kolmioseinämä** määräytyy etumerkeistä. Nolla luetaan positiiviseksi, joten jako on deterministinen.
  Bitit: bit0 = x<0, bit1 = y<0, bit2 = z<0. Nimet: F1 (+,+,+), F2 (−,+,+), F3 (−,−,+), F4 (+,−,+) ja vastaavasti
  F5–F8 alapuoliskolla.
- **Pintasuhde** lasketaan eroavien etumerkkien määrästä: 0 = sama, 1 = yhteinen särmä, 2 = yhteinen kärki,
  3 = vastakkainen.
- **Etäisyys** on suora euklidinen etäisyys (chord) 3D:ssä. Se *ei* ole oktaedrin pintaa pitkin kulkeva lyhin
  reitti (geodeesi).
- **Miksi kaksi indeksiä ovat lähellä?** Indeksiero d kääntää kulmaa d·137,5° ja siirtää z:aa 2·fract(d·a).
  Pisteet ovat lähellä vain, kun molemmat ovat lähellä kokonaislukukierrosta. Kulma on lähellä, kun d on
  Fibonacci-luku, ja z on lähellä, kun d on Pell-luku (√2 − 1:n parhaat approksimaatiot). Yksityiskohtapaneeli
  näyttää tämän erittelyn.
- **Legacy N=1M:** vanha `z = 1 − 2(n − 0,5)/N`. Saatavilla vain vertailuun, ja N-riippuvuus näkyy varoituksena.
  Testi osoittaa, että sama piste siirtyy yli 0,1 yksikköä, kun N muuttuu 1M → 10M.

## 3. 2D-kartat

- **Vogelin spiraali:** P2(n) = (√n cos θ, √n sin θ). Kun näkymä on tarpeeksi lähellä, jokainen indeksi
  piirretään ja väritetään piin numeron mukaan, ja sen jälkeen näytetään numerot itse. Kaukaa piirretään
  40 000 pisteen näyte.
- **Fibonacci-naapurit:** n ± F_k. Paikallinen parastikia on noin F_k ≈ √(5n). Esimerkiksi n ≈ 858 000:
  F17 = 1597 ja F18 = 2584. Oletuksena näytetään k* − 3 … k* + 2.
- **8 kolmion atlas:** kahdeksan erillistä tasasivuista kolmiota. Saman kvadrantin ylä- ja alapinta ovat
  vastakkain yhteisen X–Y-särmän kautta.
- **Avattu verkko:** geometrisesti oikein avattu (isometrinen) verkko. Juuri F1 (+Z keskellä). F2–F4 taittuvat
  yhteisen +Z-särmän ympäri, ja alapinnat F5–F8 omaan yläpintaansa X–Y-särmällä. Lapsikolmion kolmas kärki
  saadaan peilaamalla vanhemman kolmas kärki yhteisen särmän yli. 7 taitosta piirretään katkoviivalla.
  5 leikattua särmää esiintyy kahdesti ja saa saman kirjaimen a–e.
- **Sijainti kolmiossa:** barysentriset painot (|x|, |y|, |z|), summa 1, pinnan ±X-, ±Y- ja ±Z-kärkiin.
  Testit tarkistavat, että piste palautuu takaisin samaksi 3D-pisteeksi ja samalle pinnalle.

## 4. Valinnan synkronointi

Kaikki näkymät käyttävät samaa valintaa `{termId, n}`. Napautus projisoi näkyvät osumat ruudulle ja valitsee
lähimmän (`pickNearest`: etäisyys miinus merkin säde). Testit tarkistavat jokaiselle kartalle (spiraali,
atlas, verkko, 3D-projektio), että napautus osuman kohdalle palauttaa saman n:n. 1D-leike luetaan suoraan
lähdeaineistosta.

## 5. 4D ja 5D

- `P4 = (x, y, z, n)`. n on piin järjestysindeksi (”π-järjestysaika”), *ei* fyysistä aikaa.
- `P5 = (x, y, z, n, eventTimestamp)`. Viides arvo on olemassa vain, jos käyttäjä on itse linkittänyt osuman
  elämäntapahtumaan. Muuten se on `null`. Linkkejä ei luoda automaattisesti.
- Numerot-välilehden aikajanat ovat erilliset: π-indeksi ja kalenteri. Yhdysviivat vastaavat vain käyttäjän
  linkkejä. Tämä ei ole fyysinen 5D-avaruus.

## 6. Tilastollinen kontrolli

**Nollamalli.** Jokaisen termin todellinen osumamäärä k säilytetään. Nollamallissa k osumaa sijoitetaan
tasajakautuneesti, ilman toistoja, alkukohtiin 1 … N − L + 1. Sama kartoitus (1D, 2D tai 3D) ja sama
testisuure lasketaan R kertaa. Satunnaisluvut tulevat generaattorista xoshiro128**, jonka siemen alustetaan
splitmix32:lla. Kokonaisluvut arvotaan hylkäysotannalla ilman modulovinoumaa. Sama siemen antaa saman
jakauman myös pääsäikeen varapolussa (testattu).

**Testisuureet** (pienempi = lähempänä):

| | Määritelmä | Milloin |
| --- | --- | --- |
| S1 | min etäisyys ankkurista B-osumiin | Ehdollinen ankkurille. Vinoutuu, jos ankkuri valittiin, koska B oli lähellä. |
| S2 | min etäisyys yli kaikkien A–B-parien | Korjaa ankkurin jälkikäteisvalinnan |
| S3 | B-osumien keskimääräinen etäisyys lähimpään A:han | Yleinen läheisyys, ei vain yksi pari |

**p-arvo:** p = (1 + #{null ≤ havaittu}) / (R + 1). Epävarmuus ilmoitetaan Wilsonin 95 %:n välinä osuudelle
#{null ≤ havaittu} / R. Lisäksi raportoidaan, kuinka monta prosenttia nollamalleista on kauempana.

**Lisäkontrolli:** siemenelliset satunnaiset 0–9-jonot, joiden pituus on N. Niistä haetaan täsmälleen samat
koodit ja lasketaan sama testisuure (S1 korvataan S2:lla, koska satunnaisjonossa ei ole ankkuria).

**Luokittelu.** Sanaa ”merkityksellinen” ei käytetä. Testit varmistavat tämän.

- p > α → *Ei poikkeamaa*
- p ≤ α, ei lukittu → *Eksploratiivinen havainto* (ei vahvistava)
- p ≤ α, lukittu ennen ajoa → *Ennalta lukittu: p ≤ α tässä nollamallissa*. Tämä ei todista tarkoituksellisuutta.

**Esirekisteröinti:** hypoteesi, parametrit ja aikaleima tallennetaan SHA-256-tiivisteenä. Kysymyksen
identiteetti on termit, koodit, metriikka, testisuure, ankkuri ja aineiston tiiviste. Jos sama kysymys on
ajettu ennen lukitusta, tulos on eksploratiivinen, vaikka siemen, R tai α muuttuisi.

**Monivertailu:** jokainen ajo kirjataan. Lokissa näkyvät p, BH-q ja Bonferroni sekä varoitus, että m testistä
noin m·α antaa p ≤ α sattumalta. Lokin tyhjennys kirjataan muutoshistoriaan.

**Kalibrointi:** yksikkötesti ajaa 120 testiä, joissa ”havainto” arvotaan itse nollamallista. p ≤ 0,05 -tuloksia
on alle 13 % (odotus 5 %), eli testi ei tuota järjestelmällisesti vääriä poikkeamia.

## 7. Suorituskyky ja toimivuus

- Haku ja Monte Carlo ajetaan Web Workerissa (inline-blob, toimii myös yhden tiedoston julkaisussa). Jos
  worker ei käynnisty 4 sekunnissa tai on estetty, sama käsittelijä ajetaan pääsäikeessä 20 kierroksen
  paloissa.
- Miljoonaa numeroa ei piirretä DOM-elementteinä. 3D:ssä piirretään 24 000 näytepistettä ja termien osumat
  (`THREE.Points`, yksi piirtokutsu termiä kohden). Kuva päivitetään vain, kun näkymä liikkuu.
- 2D-kartat ovat canvasia. Spiraalin tiheä tila laskee vain näkymän renkaan indeksit (alle 260 000).
- SHA-256 lasketaan WebCryptolla. Ilman secure contextia (esim. `http://192.168.x.x`) käytetään puhdasta
  JS-toteutusta.

## 8. Testit

`npm test` ajaa 403 testiä (17 tiedostoa, joista Path Discovery 126). Tehtävänannon hyväksymiskriteerit:

| Kriteeri | Testi |
| --- | --- |
| `encodeT9` MATTI/IDA/MINI, `encodeA1Z26`, `encodeUtf8Triples` | `tests/encodings.test.ts` |
| `findAll('62884')` ∋ 858260, 48227; 9 kpl | `tests/search.test.ts` |
| `findAll('432')` ∋ 858511, 874141; 1054 kpl | `tests/search.test.ts` |
| `findAll('6464')` ∋ 858960; ero 858511 − 858260 = 251 | `tests/search.test.ts` |
| \|x\|+\|y\|+\|z\| ≈ 1 kaikille pisteille | `tests/mapping.test.ts` |
| Vakainvarianssi 1M → 10M, `mapIndex.length === 1` | `tests/mapping.test.ts` |
| Sama pinta toisella kerralla | `tests/mapping.test.ts` |
| Valinta → sama n kaikissa kartoissa, 1D-konteksti = lähde | `tests/pick.test.ts` |
| Monte Carlo deterministinen, ei vääriä merkityksellisyysväitteitä | `tests/stats.test.ts` |

Täyden aineiston testit ohitetaan, jos `public/data/pi_digits_1m.txt` puuttuu. Pienen fixturen
(2000 ensimmäistä desimaalia) testit ajetaan aina.

`npm run e2e` (Playwright, puhelinkoko 412×915) tekee 86 tarkistusta. Ensimmäiset 22 kattavat ensimmäisen
version koko käyttötapauksen: ankkurin, MATTI- ja MINI-nimilaput 3D:ssä, napautusvalinnan 3D:ssä, spiraalissa,
atlaksessa ja verkossa, lähdenumeroiden tarkistuksen, Monte Carlo -testin, esirekisteröinnin,
satunnaisjonokontrollin, termin lisäyksen ääkkösillä ja tapahtuman linkityksen. Seuraavat 44 käyvät läpi
tarinamatriisin (luku 9; luettelo: MATRIISI.md, luku 10) ja viimeiset 20 Path Discoveryn (luku 10).
Konsolivirheitä ei saa olla. Sama ajetaan myös ilman Web Workeria (`PI_ATLAS_NO_WORKER=1`) ja yhden tiedoston
julkaisuversiolle.

| Kriteeri | Testi |
| --- | --- |
| Ensimmäinen testireitti, haarat, 432-suunta, samannimiset | `tests/matrix-expand.test.ts`, `tests/matrix-story.test.ts` |
| 369, hyppysäännöt ja reittitesti (determinismi, kalibrointi) | `tests/matrix-ops.test.ts`, `tests/matrix-route.test.ts` |
| Tallennus ja lataus, ajoitussääntö, verkkokuvan asettelu, solmuvalitsin | `tests/matrix-state.test.ts` |
| Reittitestin tila storessa, lukitus, navigointi (Matriisi-painike, murut, valitsin) | `tests/matrix-actions.test.ts`, `tests/matrix-nav.test.ts` |
| Polkuhaku: koodaus ja poiminta, säännöt, haku (tarkkuus, determinismi, syyt), täysi aineisto | `tests/path-identifiers.test.ts`, `tests/path-search.test.ts` |
| Path Score, nollamallit, toistettavuus, kalibrointi; sokkotesti (vuodot, harhauttimet, p-arvo, johtopäätös) | `tests/path-score.test.ts`, `tests/path-blind.test.ts` |
| Polkuhaun tila: lukitus ennen moottorikutsua, eksploratiivisuus, monivertailu, tallennus ja lataus | `tests/path-state.test.ts` |

## 9. Tarinamatriisi

Määrittely, solmutyypit, suunnat, 369, hyppysäännöt ja reittitesti: [MATRIISI.md](MATRIISI.md).

| Osa | Tiedosto |
| --- | --- |
| Tyypit, solmuavaimet, kerrokset (`Realm`, `Layer`), suunnat | `src/core/matrix/types.ts` |
| Solmun avaus `expand(ref, env)`, ryhmät, jäljitys | `src/core/matrix/expand.ts` |
| Reitti (murupolku), silmukoiden esto, ensimmäinen testireitti | `src/core/matrix/trail.ts` |
| Tarinamalli, siemendata, samannimiset, polkujen yhdistys | `src/core/matrix/story.ts`, `seed.ts` |
| 369-avausavain, hyppysäännöt, reittitesti | `src/core/matrix/ops369.ts`, `jumps.ts`, `route-test.ts` |
| Sovellustila, tallennus ja tarkistimet, π-faktat, ajoitus | `src/state/matrix.ts` |
| Toiminnot (avaus, 369, tallennus, reittitesti, tarinan muokkaus) | `src/state/matrix-actions.ts` |
| Käsin valittu solmu ja osuma polun loppuun, tapahtumien henkilölinkit | `src/state/matrix-select.ts` |
| Näkymä ja osat | `src/ui/views/MatrixView.tsx`, `src/ui/matrix/` |

- Ydinkirjasto on puhdas: sama viite ja sama ympäristö antavat samat yhteydet samassa järjestyksessä.
  Osumayhteys syntyy vain, jos osuma löytyy lähdeaineistosta (`verifyHit`).
- Reittitesti ajetaan samassa Web Workerissa kuin Monte Carlo (`routeTest`-viesti), ja varapolulla
  pääsäikeessä. Sama siemen antaa saman p:n kummassakin.
- Matriisin tila tallennetaan samaan `localStorage`-avaimeen kuin muu tila (`pi-atlas:v1`): tarinamalli,
  reitti (solmuavaimet ja `via`), tallennetut reitit, 500 viimeisintä lokimerkintää, 2000 vierailua, 300
  reittitestiä, rajaamaton ajohakemisto (`runIndex`) ja lukitukset. Odottava tallennus tehdään heti, kun sovellus siirtyy taustalle (`pagehide`,
  `visibilitychange`). Virheellinen data korvataan oletuksella kohde kerrallaan.
- Verkkokuva on SVG. Kehän kulmat valitaan niin, ettei keskilappu peitä solmuja (`ringLayout`,
  `src/ui/matrix/labels.ts`); kuvan korkeus seuraa nimilappujen ulottumaa.

## 10. Path Discovery

Määrittely, säännöt, pysäytysehto, Path Score, sokkotesti, käyttöliittymä ja ensimmäiset tulokset:
[POLKUHAKU.md](POLKUHAKU.md).

| Osa | Tiedosto |
| --- | --- |
| Tyypit, oletusparametrit, versiot | `src/core/path/types.ts` |
| Tunnisteiden koodaus, poiminta tekstistä, aikarajaus, samat joukot | `src/core/path/identifiers.ts` |
| Säännöt (särmät), sanastograafi, käänteisyys | `src/core/path/rules.ts` |
| Haku 234 / 432 / kaksisuuntainen, syyt, sormenjälki | `src/core/path/search.ts` |
| Kanoninen kysely, `stableStringify`, FNV-1a | `src/core/path/canonical.ts` |
| Osumalähteet: π, tasajakauma, satunnaisjono | `src/core/path/source.ts` |
| Satunnaisvertailu ja Path Score | `src/core/path/score.ts` |
| Sokkotesti ja harhautinnimet | `src/core/path/blind.ts`, `decoy-names.ts` |
| Moottoripyynnöt `pathSearch`, `pathNull`, `blindTest` | `src/engine/handlers.ts` |
| Tila, avaimet, eksploratiivisuus, tallennus ja tarkistimet | `src/state/path.ts` |
| Toiminnot (lukitus, ajot, keskeytys, tallennus, reitti kartoille) | `src/state/path-actions.ts` |
| Etsi reitti, tulos, reittikartta, Sokkotesti, yhteiset osat | `src/ui/matrix/PathPage.tsx`, `PathResult.tsx`, `PathMap.tsx`, `BlindPage.tsx`, `path-bits.tsx` |
| Reitti spiraalissa, atlaksessa, verkossa ja 3D:ssä | `src/ui/views/MapView.tsx`, `SpaceView.tsx`, `space-scene.ts`, `src/ui/components/RouteOverlayChip.tsx` |

- Haku, satunnaisvertailu ja sokkotesti ajetaan samassa Web Workerissa kuin muu laskenta, ja varapolulla
  pääsäikeessä (vertailu ja sokkotesti välitauoin, yksittäinen haku yhtenä palana). Sama siemen antaa saman
  tuloksen kummassakin. Vain yksi moottorityö kerrallaan koko matriisissa (myös reittitestin kanssa).
- SHA-256 lasketaan kanonisesta kyselystä ja ajo kirjataan tilaan ”käynnissä” ennen moottorikutsua; tulos
  kertoo, täsmäsikö moottorin kanoninen kysely lukittuun.
- Tila tallennetaan matriisin osana samaan `localStorage`-avaimeen (`pi-atlas:v1`, kenttä `matrix.path`):
  lomake, 300 viimeisintä ajoa, rajaamattomat laskurit ja eksploratiivisuuden hakemisto, 100 tallennettua
  tulosta ja 200 sokkotestiä. Näytetty tulos, käynnissä oleva työ ja reitin näyttö kartoilla
  (`AppState.pathOverlay`) ovat vain muistissa. Virheellinen data korvataan oletuksella kohde kerrallaan.
- Raportin osio `pathDiscovery` sisältää versiot, Path Scoren määritelmän ja vastuuvapauslausekkeen, ajot
  BH-q:ineen, tallennetut tulokset, sokkotestit ja monivertailun luvut. Matriisin loki käyttää lajeja
  `polkuhaku` ja `sokkotesti`.
- Täydellä aineistolla yksi haku kestää tyypillisesti millisekunteja (yksikkötestin raja 1,5 s),
  satunnaisvertailu R = 50 + 5 jonoa noin 0,1–0,4 s ja seed-tarinan sokkotesti (6 kierrosta, D = 9, 2 jonoa =
  180 hakua) noin 1 s Node.js:ssä.
