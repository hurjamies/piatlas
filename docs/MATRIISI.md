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
| `root` | pi | lähtöankkuri IDA 432 @858 511 + lähtötunnisteet + ensimmäinen testireitti + tarinan yleistulkinnat (konteksti `tarina`, esim. 23 ja 43; symbolinen) + kaikki tapahtumat aikajärjestyksessä suunnassa (päivätyt `ajallinen`, päiväämättömät viimeisinä `symbolinen`) |
| `name` | tarina | nimen T9-koodi (matemaattinen), samannimiset henkilöt, kronologinen verkko, nimeen viittaavat tulkinnat |
| `code` | pi | koodin numerot portteina (234: vasemmalta oikealle, 432: oikealta vasemmalle), kaikki osumat, nimet joista koodi syntyy, koodin tulkinnat |
| `digit` | pi | numeron tulkinnat (kontekstin `koodi`-tulkinnat ensin, sitten tarinan yleiset), muut paikat samassa koodissa |
| `hit` | pi | tarkistus lähdeaineistosta, seuraavat/edelliset saman koodin osumat, lähimmät viitekoodien osumat suunnassa, Fibonacci-naapurit n ± F_k (`geometrinen`, alue `spiraali`), 3D-lähimmät, oktaedrin atsimuuttinaapuri |
| `position` | pi | numero kohdassa n, osumat jotka alkavat tai peittävät kohdan |
| `gloss` | tarina | tulkinnan kohdehenkilö tai -nimi, konteksti, moninumeroisen symbolin koodisolmu (esim. 23 → koodi 23 kaikkine osumineen; `matemaattinen`, pelkkä merkkijonon samuus), saman symbolin muut tulkinnat |
| `person` | tarina | polut joissa henkilö on (jatko valittuun suuntaan), nimisolmu, suhteet, tapahtumat, nimen koodi |
| `homonyms` | tarina | samannimiset henkilöt kronologisessa järjestyksessä (Hanna I → II → III) |
| `path` | tarina | polun askeleet valitussa suunnassa, symbolinen numerojono, yhdistettävät polut |
| `junction` | tarina | kahden tai useamman polun yhdistys samassa henkilössä: jokaisen haaran edeltävät ja seuraavat askeleet |
| `event` | tarina | linkitetyt henkilöt, käyttäjän linkittämät π-kohdat (`symbolinen`, ei tarkistettu: termin koodia ei tunneta, joten kohta avataan π-indeksinä; tarkistetut osumat näkyvät kohtasolmussa), edellinen/seuraava tapahtuma ajassa |

**Silmukoiden esto.** `openEdge` ei koskaan lisää reitille solmua, joka on jo reitillä. Jos käyttäjä avaa
reitillä jo olevan solmun, reitti katkaistaan takaisin siihen kohtaan (”↺ jo polulla”). Suurin syvyys on
`MAX_DEPTH = 32`. Kaikki avatut solmut kirjataan (`visited`) ja merkitään käyttöliittymässä.

**Takaisin ankkuriin.** Reitti alkaa aina `root`-solmusta. Koko polku näkyy murupolkuna, ja mitä tahansa
murua napauttamalla palataan siihen. Muru sulkee myös avoimen alasivun (Tarina, Reitit, Loki), jotta fokus näkyy.

**Käsin valittu solmu** (`src/state/matrix-select.ts`). Solmuvalitsin, Tarina-sivun ja tapahtumapaneelin
”Avaa matriisissa” sekä muiden näkymien Matriisi-painike eivät kulje laskettua särmää pitkin. Ne lisäävät
solmun nykyisen polun loppuun näkyvänä askeleena, joten aiempi polku säilyy:

- Valittu solmu: ryhmä ”Valittu käyttäjän toimesta”, relaatio ”valittu käyttäjän toimesta (lähde): otsikko”,
  murussa ”… · valittu”. Taso seuraa kohteen kerrosta (π-data → matemaattinen, tarinaverkko → symbolinen), ja
  kerrosvaihto lasketaan todellisista kerroksista.
- Hakutermin osuma toisesta näkymästä (`openMatrixAtHit`): pelkällä juurella reitti juuri → koodi → osuma;
  polulla jo oleva osuma katkaisee polun siihen; muu osuma lisätään askeleena ”avattu osumasta” (tarkistettu
  lähdeaineistosta).
- Jäljitys kertoo aina, ettei askel ole laskettu yhteys edelliseen solmuun. Polulla jo oleva solmu katkaisee
  polun siihen, ja syvyysraja pätee.

**Saavutettavuus.** Jokainen tarinan yleistulkinta ja jokainen tapahtuma on avattavissa suoraan juuresta, ja
moninumeroiset tulkinnat johtavat koodisolmuunsa (juuri → tulkinta 23 → koodi 23). Tapahtumat, joita ei ole
liitetty henkilöön, ovat siis myös saavutettavissa.

## 3. Samannimiset henkilöt

`Person.name` on koodattava nimi (esim. `HANNA`), eikä se yksilöi henkilöä. Jokaisella henkilöllä on oma
`id`, oma aikajana (tapahtumat, joiden `personIds` sisältää henkilön) ja omat suhteet.

Kaksi numerointia pidetään erillään eri kentissä:

| Numerointi | Kenttä | Merkitys |
| --- | --- | --- |
| Hanna **I, II, III** | `Person.homonymOrdinal` | samannimisten kronologinen järjestys |
| Hanna **= 2**, Salla = 3, Ida = 4 | `PathStep.symbol`, `Gloss.symbol` | käyttäjän määrittelemä symbolinen kehityspolku |

Sama T9-koodi 42662 ei tee henkilöistä samaa henkilöä. Koodi on nimen ominaisuus, ei henkilön.

**Järjestysnumeron muuttaminen** (`assignHomonymOrdinals`, `upsertPerson`): kun henkilölle annetaan
järjestysnumero k, hänet otetaan ryhmästä, muut järjestetään (järjestysnumero, ajanjakson alku, luontiaika,
tunnus), ja hänet lisätään kohtaan k (rajattuna 1 … ryhmän koko). Sitten ryhmä numeroidaan 1 … n. Siirto toimii
kumpaankin suuntaan (HANNA I → 3 tekee entisestä II:sta I:n ja III:sta II:n).

**Järjestysnumerot vs. ajanjaksot.** Kronologia (`homonymChronology`) järjestetään ajanjaksojen alkupäivien
mukaan vain, jos jokaisella samannimisellä on `period.start`; muuten järjestysnumeroiden mukaan. Jos jokaisella
on sekä järjestysnumero että alkupäivä ja jokin pienemmän numeron henkilö alkaa myöhemmin kuin suuremman
(sama alkupäivä ei ole ristiriita), `validateStoryWarnings` palauttaa varoituksen, `homonymChronology` kertoo
sen kentässä `conflict`, ja samannimisten kortti, samannimisten solmu ja henkilösolmu näyttävät sen.
Numeroita ei muuteta automaattisesti: käyttäjä korjaa joko numerot tai päivämäärät. `validateStory` palauttaa
edelleen vain rakenteelliset virheet.

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

Merkinnät: kohteen tunnetut numerot ovat kohdat n … n + L₀ − 1 (osuma tai ankkuri: L₀ = koodin pituus;
π-indeksi: L₀ = 1). Viitekoodin pituus on L. Kaikki kohdat ovat 1-pohjaisia, N = aineiston pituus.

| Tunnus | Määritelmä | Odotus (ks. alla) | Särmän tyyppi |
| --- | --- | --- | --- |
| `offset-369` | Alkaako jonkin viitekoodin täsmäosuma kohdasta n + k (234) tai n − k (432), k ∈ {3, 6, 9}? Luetut kohdat: alku … alku + L − 1. | ehdollinen sijoitussumma | matemaattinen, `pi-indeksi` |
| `skip-369` | Hyppyjono askeleella s ∈ {3, 6, 9}: kohdat n, n ± s, …, n ± (L − 1)s (234: +, 432: −). Onko jono jokin viitekoodi? | ehdollinen sijoitussumma; riippuu kohdan n numerosta | matemaattinen, `pi-indeksi` |
| `mod-9` | n mod 9 ja Δn mod 9 lähimpään viitekoodin osumaan suunnassa. Löytö = Δn ≡ 0 (mod 9). | (vertailtujen Δn määrä) · 1/9 | matemaattinen, `pi-indeksi` |
| `digital-root` | dr(x) = 1 + (x − 1) mod 9 (dr(0) = 0) luvuille n, koodi ja Δn. Löytö = dr(Δn) ∈ {3, 6, 9}. **Sama informaatio kuin mod 9**, joten menetelmät eivät ole riippumattomia. | (vertailtujen Δn määrä) · 1/3 | matemaattinen, `pi-indeksi` |
| `geo-369` | 3D-lähimmän naapurin kävely viitekoodien osumien joukossa: jokainen askel lähimpään (chord) vierailemattomaan osumaan, jonka atsimuutti on suuntaan 234 vastapäivään / 432 myötäpäivään (0 < Δφ < π); tasatilanteessa pienempi n. Raportoidaan askeleet 3, 6 ja 9. Reitti on algoritminen valinta. | ei määritelty | geometrinen, `oktaedri` |
| `fib-3k` | Kohdat n ± F_{3k}, k = 1…7 (F3 = 2, F6 = 8, F9 = 34, F12 = 144, F15 = 610, F18 = 2584, F21 = 10946): alkaako niistä viitekoodin osuma? Suhde n ± F_k on spiraalinaapuruus, joten se luokitellaan samoin kuin osumasolmun Fibonacci-naapurit. | ehdollinen sijoitussumma | geometrinen, `spiraali` |

**Ehdollinen sijoitussumma** (`offset-369`, `skip-369`, `fib-3k`; `evalPlacement` tiedostossa
`src/core/matrix/ops369.ts`). Jokainen (siirtymä tai askel, viitekoodi) -pari on yksi sijoitus, joka lukee kohdat
p₀ … p_{L−1}. Sijoitus luokitellaan:

1. `ulkopuolella`: jokin p_j ∉ [1, N]. Ei lasketa odotukseen eikä löydöksi.
2. `oma` (vain yhtenäiset sijoitukset `offset-369` ja `fib-3k`): viitekoodi on sama kuin kohteen koodi, ja väli
   p₀ … p_{L−1} leikkaa kohteen välin n … n + L₀ − 1. Kohteen oman koodin päällekkäistä osumaa ei lasketa
   (todennäköisyys 0, ei löytö).
3. `rakenteellinen`: kaikki p_j ovat kohteen omalla välillä. Kyse ei ole satunnaisvertailusta, joten ei lasketa.
4. `vertailu`: lasketaan. Todennäköisyys satunnaisjonossa, kun kohteen numerot tunnetaan:
   p = Π_j f_j, missä f_j = 1/10, jos p_j on kohteen välin ulkopuolella, ja f_j = [digits[p_j] = koodi[j]] (1 tai
   0), jos p_j on kohteen välillä. Toisin sanoen p = 0, jos jokin tunnettu numero ei täsmää, muuten 10^−u, missä
   u = kohteen ulkopuolisten kohtien määrä. Löytö, jos luettu jono = koodi.

Suunnan odotus = Σ p kaikista `vertailu`-sijoituksista. Ehdoton kaava Σ 10^−L pätee vain, kun yksikään luettu
kohta ei osu kohteen välille. Seuraukset:

- `skip-369`: p₀ = n on aina kohteen numero, joten yksi sijoitus antaa 10^−(L−1), jos koodin ensimmäinen numero on
  digits[n], muuten 0. Suuntaan 234 myös n + j·s voi olla kohteen välillä (esim. 5-numeroinen kohde ja s = 3:
  kohta n + 3 on tunnettu), jolloin sekin ehdollistetaan. Esimerkki: IDA 432 @858 511 (digits[n] = 4):
  odotus suuntaan 234 = 3 · (10^−2 + 10^−4) = 0,0303 (IDA 432 ja HANNA 42662 alkavat 4:llä, muut eivät).
- `offset-369` ja `fib-3k`: pienet siirtymät (k = 3, F3 = 2) voivat osua kohteen välille. Esimerkki: HANNA 42662
  @858 610 suuntaan 234: kohdassa n + 3 MAX 629 lukee kaksi tunnettua numeroa ”62” (täsmäävät) ja yhden
  tuntemattoman → p = 10^−1; MATTI 62884 → 10^−3; HANNA itse → `oma`. Offsetin odotus 234 on 0,10526.
- Koodi-, nimi- ja henkilösolmussa sama lasketaan jokaiselle koodin osumalle (enintään 2000 ensimmäistä n:n
  mukaan) omalla välillään, ja odotukset summataan. Tulos: ”x/k osumassa löytö, odotus e”.

**Δn-menetelmät** (`mod-9`, `digital-root`). Jokaiselle viitekoodille haetaan lähin osuma suunnassa: 234 = pienin
m ≥ n + 1 (saman koodin osumille m ≥ n + L₀, eli oma ja sen kanssa päällekkäiset ohitetaan), 432 = suurin
m ≤ n − 1 (saman koodin osumille m ≤ n − L₀). Δn = |m − n|. Odotus = vertailtujen määrä · perusosuus; koodi, jolla
ei ole osumaa suunnassa, ei ole vertailu. Kohteen omat arvot (n mod 9, dr(n), dr(koodi)) ovat laskelmia, eivät
löytöjä eivätkä vaikuta odotukseen. Koodisolmulle lasketaan vain koodin arvo ja numerosumma (ei vertailuja,
odotusta ei määritellä). Polku-, tulkinta- ja yhdistyssolmuille lasketaan vain `mod-9` ja `digital-root`
käyttäjän antamista symbolinumeroista; tulos merkitään laskelmaksi käyttäjän luvuista, odotusta ei määritellä.

**Geometrinen kävely ei tuota löytöjä.** Askeleet 3, 6 ja 9 syntyvät aina, kun ehdokkaita riittää, joten ne
raportoidaan avattavina särminä erillisessä listassa (`reported`, käyttöliittymässä ”raportoidut askeleet (aina
tuotetaan)”) ilman löytöjen korostusta. `geo-369`:n `matches` = 0 eikä se vaikuta ”Ei uutta” -tulokseen.

**Ei uutta.** Menetelmän `nothingNew` = ei löytöjä kumpaankaan suuntaan. Kokonaistulos `nothingNewOverall` =
kaikilla vertailumenetelmillä (`offset-369`, `skip-369`, `mod-9`, `digital-root`, `fib-3k`) `nothingNew`;
`geo-369` ei vaikuta. Yhteenvedon löytömäärä ja odotus lasketaan vain vertailumenetelmistä; kävelyaskelten
määrä kerrotaan erikseen. Esimerkki: koodi 42662 ja HANNA III → kaikki vertailut 0 löytöä, joten tulos on
”Ei uutta”, ja lisäksi ”geo-369: 6 raportoitua kävelyaskelta”.

Henkilö- ja nimisolmu käyttää nimen koodia (kuten koodisolmu). Tapahtumalla ei ole π-sijaintia eikä
symbolinumeroita, joten 369 ei sovellu sille.

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

**Kysymys.** Reittikysymys on kanoninen (`routeQuestionKey`): koodit, järjestysehto ja aineiston SHA-256. Ehdolla
`mikä-tahansa` koodit lajitellaan, koska lyhin ikkuna ei riipu koodien järjestyksestä. Ehto `432` koodeille
c₁ … c_k kirjataan muodossa `234` käänteisille koodeille c_k … c₁. R, siemen ja satunnaisjonot eivät muuta
kysymystä. Saman koodijoukon kaikki järjestysvariantit muodostavat perheen: minkä tahansa variantin ajo on
aiempi altistus kaikille muille, koska yhden tulos kertoo myös muista.

**Lukitus ja ajoitus.** Hypoteesi lukitaan SHA-256-tiivisteellä kanonisesta sisällöstä ja aikaleimasta. Lukitus
on tämän laitteen oma kirjaus (käyttöliittymässä ”lukittu tällä laitteella”); sitä ei todenneta ulkopuolisesti.
Ajo on `ennen-löydöstä` (vahvistava) vain, jos sen kysymykselle on lukitus eikä samaa koodijoukkoa ole ajettu
kertaakaan millään järjestyksellä. Lukitus kattaa siis vain ensimmäisen ajonsa: myöhemmät ajot ovat
`löydön-jälkeen`, vaikka siemen tai R vaihtuisi. Tehtävänannosta johdetut reitit (ensimmäinen reittitesti,
testireitti ja tehtävänannon polut, myös samana koodijoukkona muussa järjestyksessä) ovat aina `löydön-jälkeen`.

**Luokitus.** ”Ennalta lukittu: p ≤ α” vaatii lukitun ensimmäisen ajon ja Wilsonin välin ylärajan ≤ α. Jos
p ≤ α mutta väli ylittää α:n, tulos on ”Ennalta lukittu, Monte Carlo ei ratkaise” eikä se ole vahvistava. Uusi
ajo suuremmalla R:llä olisi eksploratiivinen, joten R valitaan ennen lukittua ajoa.

**Ajohistoria.** Tallennukseen mahtuu 300 uusinta ajoa, mutta rajaamaton hakemisto (`runIndex`: kanoninen
kysymys → ensimmäisen ajon aika ja määrä sekä ajojen kokonaismäärä) säilyy. Ajoitussääntö, varoituksen m ja
BH-q lasketaan hakemistosta. BH-q lasketaan tallennetuista p-arvoista kaikkien ajojen m:llä; rajattujen
vanhojen ajojen p-arvot oletetaan ykkösiksi, joten q ei aliarvioidu. Vanha tallennus ilman hakemistoa
täydennetään tallennetuista ajoista.

## 8. Luotettavuus

- Ilmoitetut sijainnit tarkistetaan aineistosta ennen hyväksymistä (`verifyIdentifiers`): koodi = T9(nimi) ja
  `digits[n − 1 … n + L − 2] === koodi`. Ristiriita näytetään virheenä, eikä sijaintia käytetä.
- Jokainen `hit`-solmu tarkistetaan lähdeaineistosta (`verified`).
- Kaikki saman koodin osumat näytetään (sivutettuna), ei vain kiinnostavin. Osumamäärä näytetään odotusarvon
  kanssa.
- Loki: avaukset, suunnanvaihdot, 369- ja hyppyoperaatiot, tallennukset, reittitestit ja tarkistukset.
- Hypoteesin ajoitus (`HypothesisTiming`): `ennen-löydöstä` vain §7:n säännöllä (lukitus ennen koodijoukon
  ensimmäistä ajoa, ja vain ensimmäinen ajo). Muuten `löydön-jälkeen` tai `ei-tiedossa`.
- Tehtävänannosta tuodut polut ja reitit ovat `löydön-jälkeen`: ne muodostettiin aiemmin ilmoitettujen
  sijaintien ympärille (IDA @858 511 ilmoitettiin ennen tätä tutkimusta; HANNA @858 610, Δn +99, löytyi tässä
  tutkimuksessa). Kun polun askeleita muokataan, lähde on `käyttäjä` ja ajoitus `löydön-jälkeen` (”Muokattu”).
- Tallennettu reitti on `ennen-löydöstä` vain lukituksella, jonka kanoninen kysymys koskee täsmälleen reitin
  koodeja (`routeCodesFromTrail`) reitin järjestyksessä ja joka tehtiin ennen reitin jokaisen π-solmun
  ensimmäistä lokimerkintää ja ennen saman koodijoukon ensimmäistä ajoa. Tallennuslomake näyttää vain
  tällaiset lukitukset; muuten reitti merkitään `löydön-jälkeen` ja syy kerrotaan.
- Ladattaessa ja tuotaessa `ennen-löydöstä` ilman tämän laitteen vastaavaa lukitusta muutetaan muotoon
  `ei-tiedossa`, ja muutos näytetään tuontiraportissa tai lokissa (`tarkistus`). Lukituksen tiivisteen on oltava
  SHA-256-muotoa. Tallennettujen ajojen luokitus lasketaan uudelleen.

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
Välilehti on alapalkin viides, ja sen voi avata suoraan osoitteella `#matriisi`.

Näkymän järjestys ylhäältä alas: murupolku (pysyy ylhäällä vieritettäessä), alasivut (Verkko / Lista, Tarina,
Reitit, Loki), kerrosvaihdon ilmoitus, solmuvalitsin, ohjaus, fokussolmu, juuressa lähtötunnisteiden tarkistus, 369- ja
hyppysääntötulokset, tarinarakenteet (haarat, samannimisten kronologia, polun symbolinen numerojono),
verkkokuva ja kaikki yhteydet listana.

**Kerrosten erottelu**

- Murupolku: jokainen muru näyttää kerroksen ja yhteyden tyypin (esim. ”Tarinaverkko · Symbolinen”).
  Kerrosvaihdon kohdalla on erotin ”π-data | tarina” (tai ”tarina | π-data”). Pitkä murupolku vierii
  sivuttain, ja reunan häivytys kertoo, että sitä on lisää. Alarivi näyttää aina kerrosten järjestyksen
  (esim. ”π-data 3 | tarina 3”), joten kerrosvaihto pysyy näkyvissä, vaikka erotin olisi vieritetty pois.
- Kun fokus on tarinaverkossa, näkyy ilmoitus ”Siirryt piin todellisesta datasta symboliseen tarinaverkkoon”
  ja askel, jossa siirtymä tapahtui. Paluusta π-dataan ilmoitetaan erikseen.
- Jokainen yhteysrivi näyttää yhteyden tyypin (Matemaattinen / Geometrinen / Ajallinen / Symbolinen) ja kohteen
  kerroksen (π-data / Tarinaverkko). Kerrosvaihtava rivi näyttää molemmat, esim. ”π-data → Tarinaverkko”.
- Tarinaverkon fokussolmussa lukee: ”käyttäjän antamaa symbolista tietoa. Ei matemaattinen todiste.”

**Ohjaus**

- Lukusuunta 234 → / ← 432 ja selitysrivi fokussolmun alueista (esim. ”432 · tarina: polkua takaperin”).
  Rivin alla muistutus: 234 ja 432 eivät tarkoita hyppyjä 2, 3 ja 4.
- 369-avausavain on erillinen painike. Tulos listaa kuusi menetelmää; jokaisen otsikkorivi näyttää molemmat
  suunnat (esim. ”234: Ei uutta” ja ”432: 1 löytö”, geometrisessa kävelyssä ”3 raportoitua askelta” ilman
  löytöjen korostusta). Menetelmän avaamalla
  näkyvät löydöt, odotukset ja kaikki tarkistukset. Tuloksen alussa on vastuuvapauslauseke ja viitekoodit.
- Hyppysäännöt, reitin tallennus ja ensimmäinen testireitti ovat omia painikkeitaan. Juuren korttiin on lisäksi
  painike ”Avaa ensimmäinen testireitti: MAX (629) → 2 → HANNA → HANNA III”.
- Osumasolmusta pääsee samaan osumaan spiraalissa, 3D:ssä, atlaksessa ja π-indeksissä. Muiden näkymien
  alapaneelin Matriisi-painike avaa osuman: tyhjällä polulla juuri → koodi → osuma todellisia yhteyksiä pitkin,
  muuten nykyinen polku säilyy (§2, käsin valittu solmu). Ilmoitus kertoo, kumpi tapahtui.
- **Valitse solmu** (taitettava, ohjauksen yläpuolella): numerojono tarjoaa koodisolmun, saman symbolin
  tulkinnat (myös yksinumeroiset) ja π-indeksin aineiston rajoissa; `@n` tai `n=…` avaa π-indeksin; teksti
  tarjoaa nimet, henkilöt, tulkinnat, polut ja tapahtumat; tyhjä haku listaa tarinan henkilöt, tulkinnat,
  polut ja tapahtumat (enintään 40 kerrallaan). Valinta lisätään murupolkuun (§2).
- Yhteyslistan ”Näytä kaikki (k)” piirtää rivit vaiheittain (100 riviä animaatiokehystä kohden) ja näyttää
  etenemisen (”Piirretään rivejä: x/y…”), joten esimerkiksi koodin 629 1 040 riviä eivät jumita pääsäiettä.
  Näytettyjen rivien määrä ja suljetut ryhmät säilyvät, kun suunta vaihtuu.

**Verkkokuva**

- Fokus keskellä ja enintään 24 kohdetta kehällä (ryhmät vuorotellen), loput listassa. Viiva: matemaattinen
  yhtenäinen turkoosi, geometrinen violetti, ajallinen pisteviiva, symbolinen katkoviiva. Nuoli = suunnallinen,
  vinoneliö = kerrosvaihto, ↺ = jo polulla.
- Keskilappu on vaakasuora. Kehän kulmat valitaan niin, ettei lappu peitä solmuja (`ringLayout`): tasavälinen
  kehä, jos se onnistuu; muuten solmut ylä- ja alakaarelle; ahtaalla kehällä lapun teksti lyhennetään. Kuvan
  korkeus seuraa nimilappujen ulottumaa, joten vähän kohteita sisältävä kuva on matala.

**Tallennus**

- Tarina, reitti (solmuavaimet + `via`), suunta, tallennetut reitit, loki (500), vierailut (2000),
  reittitestit (300 uusinta + rajaamaton ajohakemisto) ja hypoteesilukitukset tallentuvat vain laitteelle
  (`localStorage`). Odottava tallennus tehdään heti, kun sovellus siirtyy taustalle. Virheellinen data korvataan oletuksella kohde kerrallaan, ja ohitukset
  kirjataan lokiin (`tarkistus`). Muokattua tarinaa ei korvata siemenellä.
- Reitin tallennus tarkistaa jokaisen reitin osuman, koodin, numeron ja kohdan lähdeaineistosta (`mathFacts`).
- Reittitestin hypoteesi voidaan lukita SHA-256-tiivisteellä (tällä laitteella). Ajoitus on `ennen-löydöstä` vain
  lukitusta seuraavalle ensimmäiselle ajolle, jos samaa koodijoukkoa ei ollut ajettu millään järjestyksellä (§7).
  R, siemen ja satunnaisjonot eivät muuta kysymystä. Reittitestin lomake ja käynnissä oleva ajo (eteneminen,
  Keskeytä) pysyvät muistissa, kun Reitit-sivulta poistutaan; toista ajoa ei voi käynnistää samaan aikaan.
  Keskeytä toimii myös ilman Web Workeria: pääsäikeessä laskenta keskeytyy seuraavassa välitauossa, eikä
  keskeytettyä ajoa kirjata.
- Tarinan palautus siemeneen tai tuonti listaa vahvistuksessa tapahtumat, joiden henkilölinkit osoittaisivat
  henkilöihin, joita uudessa tarinassa ei ole. Vahvistus poistaa ne linkit ja kirjaa poiston muutoshistoriaan.
  Tapahtumapaneeli näyttää tällaiset linkit poistettavina merkkeinä.

**Päästä päähän -testi** (`scripts/e2e.cjs`, puhelinkoko 412×915 ja 360 px): lähtötunnisteet IDA @858 511 ✓,
MATTI @858 260 ✓ ja MINI @858 960 ✓; ensimmäinen testireitti ja sen murut; kerrosvaihdon erotin, alarivi ja
ilmoitus; HANNA III:n haarat suuntaan 234; suunnan 432 selitys ja polku B käänteisenä; reitillä olevan solmun
avaus ei monista murua; HANNA I → II → III ja T9 42662; ankkuriosumasta HANNA @858 610 (Δn +99) ✓ ja koodin
42662 seitsemän osumaa ja 369 koodissa 42662 (”Ei uutta”, geo-369 vain raportoituja askeleita); 369:n kuusi
menetelmää molempiin suuntiin osumassa; reitin tallennus (askelten kerros ja tyyppi) ja reittitesti (R = 200):
ensimmäinen testireitti on lukittunakin ”löydön jälkeen” syineen, uuden koodijoukon lukittu ensimmäinen ajo on
”ennen löydöstä” ja toinen ajo ”löydön jälkeen”; käynnissä oleva ajo (R = 5 000) säilyy Reitit-sivulta
poistuttaessa ja Keskeytä pysäyttää sen; tarinan tallennus laitteelle ja uudelleenlataus; siirtymät spiraaliin
ja takaisin, ja Matriisi-painike säilyttää polun (polulla oleva osuma → paluu, uusi osuma → polun loppuun);
solmuvalitsin (tulkinta 23 kerrosvaihtoineen, koodi 43); koodin 629 ”Näytä kaikki” → 1 040 riviä ja säilyy
suunnan vaihdossa; tapahtuman ”Avaa matriisissa”; murun napautus Loki-sivulla; jokaisen yhteysrivin tyyppi ja
kerros; ei vaakaylivuotoa, leikkautuvia nimilappuja eikä keskilapun alle jääviä solmuja; ei verkkopyyntöjä
sovelluksen ulkopuolelle eikä konsolivirheitä. Sama ilman Web Workeria (`PI_ATLAS_NO_WORKER=1`).
