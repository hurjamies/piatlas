# PI ATLAS: tekninen kuvaus

Versiotunnukset (näkyvät sovelluksessa ja jokaisessa raportissa): kartoitus `PIATLAS-MAP-1.0.0`, koodaukset
`PIATLAS-ENC-1.0.0`, tilastot `PIATLAS-MC-1.0.0`, avattu verkko `PIATLAS-NET-1.0.0`. Jos jokin kaava muuttuu,
tunnus vaihtuu, jotta vanhat tulokset voidaan toistaa.

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

`npm test` ajaa 59 testiä. Tehtävänannon hyväksymiskriteerit:

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

`npm run e2e` (Playwright, puhelinkoko 412×915) tekee 22 tarkistusta. Ne kattavat ensimmäisen version koko
käyttötapauksen: ankkurin, MATTI- ja MINI-nimilaput 3D:ssä, napautusvalinnan 3D:ssä, spiraalissa, atlaksessa
ja verkossa, lähdenumeroiden tarkistuksen, Monte Carlo -testin, esirekisteröinnin, satunnaisjonokontrollin,
termin lisäyksen ääkkösillä ja tapahtuman linkityksen. Konsolivirheitä ei saa olla. Sama ajetaan myös ilman
Web Workeria (`PI_ATLAS_NO_WORKER=1`) ja yhden tiedoston julkaisuversiolle.
