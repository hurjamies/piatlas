# Recursive Story Matrix — määrittely (PIATLAS-MATRIX-1.0.0)

Tämä on PI ATLASin rekursiivisen numerokartan ja haarautuvan tarinamoottorin määrittely. Se on osa nykyistä
sovellusta (Vite + React + TypeScript, oma tila `src/state/store.ts`, laskenta `src/core/`, Web Worker
`src/engine/`). Olemassa olevia piin koordinaatteja (`mapIndex`, `vogel`, `PIATLAS-MAP-1.0.0`) tai
koodaussääntöjä (`PIATLAS-ENC-1.0.0`) ei muuteta. Uusi moduuli vain lukee niitä.

## 1. Kaksi kerrosta

| Kerros (`Realm`) | Sisältö | Esimerkkejä |
| --- | --- | --- |
| `pi` — matemaattinen kerros | vain laskennallisesti todettavaa | piin desimaalit, koodit, osumat, Δn, koordinaatit, algoritmiset reitit, tilastot |
| `tarina` — symbolinen tarinakerros | käyttäjän antamat merkitykset | henkilöt, suhteet, tapahtumat, elämänvaiheet, numeroiden tulkinnat |

Jokaisella yhteydellä (`MatrixEdge`) on täsmälleen yksi tyyppi (`Layer`):

- `matemaattinen` — laskettu π-datasta tai koodauksesta (osuma, Δn, koodin numero, mod 9, …)
- `geometrinen` — laskettu valitusta kartoituksesta (spiraali, oktaedri, chord-etäisyys). Kartoitus on valinta,
  ei piin ominaisuus.
- `ajallinen` — käyttäjän antama kalenteri- tai kronologiajärjestys
- `symbolinen` — käyttäjän tulkinta

Kun polku siirtyy `pi`-kerroksesta `tarina`-kerrokseen (tai takaisin), särmä merkitään `crossesRealm = true` ja
käyttöliittymä näyttää selvästi: *”Siirryt piin todellisesta datasta symboliseen tarinaverkkoon.”*

Symbolista tulkintaa ei koskaan kutsuta matemaattiseksi todisteeksi. Sanaa ”merkityksellinen” ei käytetä
tilastollisessa mielessä (sama sääntö kuin `stats.ts`:ssä).

## 2. Solmut ja rekursiivinen avaus

Solmu on serialisoitava viite `NodeRef` (`src/core/matrix/types.ts`). Avaus `expand(ref, env)` on puhdas
funktio, joka palauttaa solmun tiedot ja kaikki siitä lähtevät särmät. Saman solmun voi avata useasta
reitistä, eikä alkuperäinen solmu katoa: reitti (`trail`) on lista askelia, ja jokainen askel tallentaa,
minkä särmän kautta siihen tultiin.

| Solmu | Kerros | Avautuu |
| --- | --- | --- |
| `root` | pi | lähtöankkuri IDA 432 @858 511 + lähtötunnisteet + ensimmäinen testireitti |
| `name` | tarina | nimen T9-koodi (matemaattinen), samannimiset henkilöt, kronologinen verkko, nimeen viittaavat tulkinnat |
| `code` | pi | koodin numerot portteina (234: vasemmalta oikealle, 432: oikealta vasemmalle), kaikki osumat, nimet joista koodi syntyy, koodin tulkinnat |
| `digit` | pi | numeron tulkinnat (kontekstin `koodi`-tulkinnat ensin, sitten tarinan yleiset), muut paikat samassa koodissa |
| `hit` | pi | tarkistus lähdeaineistosta, seuraavat/edelliset saman koodin osumat, lähimmät viitekoodien osumat suunnassa, Fibonacci-naapurit, 3D-lähimmät, oktaedrin atsimuuttinaapuri |
| `position` | pi | numero kohdassa n, osumat jotka alkavat tai peittävät kohdan |
| `gloss` | tarina | tulkinnan kohdehenkilö tai -nimi, saman symbolin muut tulkinnat |
| `person` | tarina | polut joissa henkilö on (jatko valittuun suuntaan), nimisolmu, suhteet, tapahtumat, nimen koodi |
| `homonyms` | tarina | samannimiset henkilöt kronologisessa järjestyksessä (Hanna I → II → III) |
| `path` | tarina | polun askeleet valitussa suunnassa, symbolinen numerojono, yhdistettävät polut |
| `junction` | tarina | kahden tai useamman polun yhdistys samassa henkilössä: jokaisen haaran edeltävät ja seuraavat askeleet |
| `event` | tarina | linkitetyt henkilöt ja osumat, edellinen/seuraava tapahtuma ajassa |

**Silmukoiden esto.** `openEdge` ei koskaan lisää reitille solmua, joka on jo reitillä. Jos käyttäjä avaa
reitillä jo olevan solmun, reitti katkaistaan takaisin siihen kohtaan (”↺ jo polulla”). Suurin syvyys on
`MAX_DEPTH = 32`. Kaikki avatut solmut kirjataan (`visited`) ja merkitään käyttöliittymässä.

**Takaisin ankkuriin.** Reitti alkaa aina `root`-solmusta. Koko polku näkyy murupolkuna, ja mitä tahansa
murua napauttamalla palataan siihen.

## 3. Samannimiset henkilöt

`Person.name` on koodattava nimi (esim. `HANNA`), eikä se yksilöi henkilöä. Jokaisella henkilöllä on oma
`id`, oma aikajana (tapahtumat, joiden `personIds` sisältää henkilön) ja omat suhteet.

Kaksi numerointia pidetään erillään eri kentissä:

| Numerointi | Kenttä | Merkitys |
| --- | --- | --- |
| Hanna **I, II, III** | `Person.homonymOrdinal` | samannimisten kronologinen järjestys |
| Hanna **= 2**, Salla = 3, Ida = 4 | `PathStep.symbol`, `Gloss.symbol` | käyttäjän määrittelemä symbolinen kehityspolku |

Sama T9-koodi 42662 ei tee henkilöistä samaa henkilöä. Koodi on nimen ominaisuus, ei henkilön.

## 4. Suunnat 234 ja 432

`Direction` on navigointimenetelmä: `'234'` = etenevä, `'432'` = käänteinen. Se tulkitaan aina jossakin
alueessa (`DirectionDomain`), ja jokainen suunnallinen särmä kertoo alueen:

| Alue | 234 | 432 |
| --- | --- | --- |
| `pi-indeksi` | kasvava n | pienenevä n |
| `koodi` | numerot vasemmalta oikealle | oikealta vasemmalle |
| `spiraali` | ulospäin: n + F_k | sisäänpäin: n − F_k |
| `oktaedri` | vastapäivään +Z-akselin ympäri (atsimuutti kasvaa) | myötäpäivään |
| `tarina` | polun määrittelyjärjestys | polku takaperin |
| `aika` | vanhimmasta uusimpaan | uusimmasta vanhimpaan |

234 ja 432 **eivät** tarkoita indeksihyppyjä 2, 3 ja 4. Hyppysäännöt ovat erillisiä nimettyjä operaatioita
(kohta 6).

## 5. 369-avausavain (PIATLAS-369-1.0.0)

369 ei ole suodatin. Se on käyttäjän erikseen käynnistämä operaatio yhdelle solmulle. Jokainen menetelmä
ajetaan sekä valittuun suuntaan että vastakkaiseen. Tulos näyttää kaikki tarkistukset, myös ne, joissa mitään
ei löytynyt, ja odotetun satunnaisosumien määrän, kun se voidaan laskea. 369 ei koskaan tuota tulkintaa.

Viitekoodit: tarinan lähtötunnisteiden ja henkilöiden nimien T9-koodit (IDA, MATTI, HANNA, SALLA, MAX, MINI ja
käyttäjän lisäämät). Lista näytetään tuloksessa.

| Tunnus | Määritelmä (osuma alkaa kohdasta n, pituus L) |
| --- | --- |
| `offset-369` | Alkaako jonkin viitekoodin täsmäosuma kohdasta n + k (234) tai n − k (432), k ∈ {3, 6, 9}? Odotus Σ_koodit 3 · 10^−L. |
| `skip-369` | Hyppyjono askeleella s ∈ {3, 6, 9}: numerot kohdista n, n ± s, n ± 2s, … Onko sen alku jokin viitekoodi? Odotus 10^−L / koodi / askel. |
| `mod-9` | n mod 9 ja Δn mod 9 lähimpään viitekoodin osumaan suunnassa. Löytö = Δn ≡ 0 (mod 9), perusosuus 1/9. |
| `digital-root` | Digitaalinen juuri dr(x) = 1 + (x − 1) mod 9 luvuille n, koodi ja Δn. Juuri ∈ {3, 6, 9} on perusosuudella 1/3. **Sama informaatio kuin mod 9**, joten menetelmät eivät ole riippumattomia. |
| `geo-369` | 3D-lähimmän naapurin kävely viitekoodien osumien joukossa: jokainen askel lähimpään (chord) vierailemattomaan osumaan, jonka atsimuutti on suuntaan 234 vastapäivään / 432 myötäpäivään (0 < Δφ < π). Raportoidaan askeleet 3, 6 ja 9. Reitti on algoritminen valinta. |
| `fib-3k` | Kohdat n ± F_{3k}, k = 1…7 (F3 = 2, F6 = 8, F9 = 34, F12 = 144, F15 = 610, F18 = 2584, F21 = 10946): alkaako niistä viitekoodin osuma? Odotus Σ 7 · 10^−L. |

Koodisolmulle menetelmät `offset-369`, `skip-369` ja `fib-3k` ajetaan koodin kaikille osumille (enintään 2000),
ja tulos ilmoitetaan muodossa ”x/k osumassa löytö, odotus e”. Henkilö- ja nimisolmu käyttää nimen koodia.
Polku- ja tulkintasolmuille lasketaan vain `mod-9` ja `digital-root` käyttäjän antamista symbolinumeroista, ja
tulos merkitään laskelmaksi käyttäjän antamista luvuista.

## 6. Nimetyt hyppysäännöt (PIATLAS-JUMP-1.0.0)

| Tunnus | Määritelmä |
| --- | --- |
| `hyppy-2-3-4` | Kohdat n + 2, n + 5, n + 9 (kumulatiiviset hypyt +2, +3, +4). Luetaan numerot ja verrataan 3-numeroisiin viitekoodeihin. |
| `hyppy-4-3-2` | Kohdat n − 4, n − 7, n − 9 (hypyt −4, −3, −2). |

Hyppysääntö ajetaan vain käyttäjän pyynnöstä. Lukusuunnan vaihto ei käynnistä sitä.

## 7. Reittitesti satunnaisvertailulla (PIATLAS-ROUTE-1.0.0)

Reitin koodit c₁ … c_k (esim. MAX, HANNA, SALLA, IDA). Testisuure on **lyhin ikkuna**: valitaan jokaiselle
koodille yksi osuma ja minimoidaan max(n) − min(n). Järjestysvaihtoehdot:

- `mikä-tahansa`: osumien järjestyksellä ei ole väliä
- `234`: n₁ < n₂ < … < n_k (reitin järjestyksessä kasvava n)
- `432`: n₁ > n₂ > … > n_k

Kaikki osumat ovat mukana, eli ankkuria ei käytetä. Tämä korjaa ankkurin jälkikäteisvalinnan. Nollamalli on
sama kuin `stats.ts`:ssä: jokaisen koodin todellinen osumamäärä k_i sijoitetaan tasajakautuneesti ilman
toistoja alkukohtiin 1 … N − L_i + 1, R kertaa, siemenellä (xoshiro128**). p = (1 + #{null ≤ havaittu}) / (R + 1),
Wilsonin 95 %:n väli. Lisäksi voidaan ajaa satunnaisjonokontrolli (siemenelliset 0–9-jonot, samat koodit).

Jokainen ajo kirjataan matriisin lokiin ja yhteiseen muutoshistoriaan. Ajojen määrä näytetään
monivertailuvaroituksena.

## 8. Luotettavuus

- Ilmoitetut sijainnit tarkistetaan aineistosta ennen hyväksymistä (`verifyIdentifiers`): koodi = T9(nimi) ja
  `digits[n − 1 … n + L − 2] === koodi`. Ristiriita näytetään virheenä, eikä sijaintia käytetä.
- Jokainen `hit`-solmu tarkistetaan lähdeaineistosta (`verified`).
- Kaikki saman koodin osumat näytetään (sivutettuna), ei vain kiinnostavin. Osumamäärä näytetään odotusarvon
  kanssa.
- Loki: avaukset, suunnanvaihdot, 369- ja hyppyoperaatiot, tallennukset, reittitestit ja tarkistukset.
- Hypoteesin ajoitus (`HypothesisTiming`): `ennen-löydöstä` vain, jos hypoteesi on lukittu SHA-256-tiivisteellä
  ennen reittitestin ajoa. Muuten `löydön-jälkeen` tai `ei-tiedossa`. Tehtävänannosta tuodut polut ovat
  `ei-tiedossa`, koska niiden suhdetta aiempiin löytöihin ei tiedetä.

## 9. Ensimmäinen testitapaus

Lähtöankkuri IDA 432 @858 511. Lähtötunnisteet: MATTI 62884, HANNA 42662, SALLA 72552, MAX 629, MINI 6464.

Ensimmäinen avattava reitti:

```
root → MAX (code 629) → numero 2 (digit 629#1) → tulkinta "2 = HANNA (konteksti MAX 629)" (gloss)
     → HANNA (name, symbolinen) → HANNA III (person)
         ├─ polku A, sukupolvien jatkuvuus: MATTI (6) → HANNA (2) → MAX (9)     jatko 234: → MAX
         └─ polku B, ihmissuhteiden kehityspolku: HANNA (2) → SALLA (3) → IDA (4)  jatko 234: → SALLA → IDA
            käänteinen 432: IDA → SALLA → HANNA
```

HANNA-nimisolmusta avautuu kolmen Hannan kronologinen verkko: HANNA I → HANNA II → HANNA III.

Polun B symbolinen numerojono 432-suuntaan on ”432”, joka on sama merkkijono kuin IDAn T9-koodi. Tämä näytetään
merkkijonojen yhtäläisyytenä käyttäjän antamien numeroiden ja koodin välillä. Se ei ole π-havainto. Polun A
numerot 6-2-9 on johdettu MAXin koodista, joten polun ja koodin yhtäläisyys on rakenteellinen.

## 10. Käyttöliittymä (Matriisi-välilehti)

Tila on `src/state/matrix.ts` (puhtaat apufunktiot: tallennus ja lataus, π-faktat, ajoitussääntö) ja
`src/state/matrix-actions.ts` (toiminnot). Näkymä on `src/ui/views/MatrixView.tsx` ja osat `src/ui/matrix/`.

- Murupolku: jokainen muru näyttää kerroksen ja yhteyden tyypin; kerrosvaihdon kohdalla erotin ”π-data | tarina”.
  Kun fokus on tarinaverkossa, näkyy ilmoitus ”Siirryt piin todellisesta datasta symboliseen tarinaverkkoon”.
- Verkko: fokus keskellä ja enintään 24 kohdetta kehällä (ryhmät vuorotellen), loput listassa. Viiva: matemaattinen
  yhtenäinen turkoosi, geometrinen violetti, ajallinen pisteviiva, symbolinen katkoviiva. Nuoli = suunnallinen,
  vinoneliö = kerrosvaihto.
- Tallennus: tarina, reitti (solmuavaimet + `via`), suunta, tallennetut reitit, loki (500), vierailut (2000),
  reittitestit ja hypoteesilukitukset paikallisesti (`localStorage`). Virheellinen data korvataan oletuksella
  kohde kerrallaan, ja ohitukset kirjataan lokiin (`tarkistus`). Muokattua tarinaa ei korvata siemenellä.
- Reitin tallennus tarkistaa jokaisen reitin osuman, koodin, numeron ja kohdan lähdeaineistosta (`mathFacts`).
- Reittitestin hypoteesi voidaan lukita SHA-256-tiivisteellä. Ajoitus on `ennen-löydöstä` vain, jos lukitus tehtiin
  ennen kuin samaa kysymystä (koodit + järjestys + aineisto) oli ajettu. R, siemen ja satunnaisjonot eivät muuta
  kysymystä.
