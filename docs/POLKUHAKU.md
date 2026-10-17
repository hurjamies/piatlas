# Path Discovery Engine — määrittely (PIATLAS-PATH-1.0.0)

Path Discovery etsii piin desimaaleista laskettavia reittejä käyttäjän lähtötilan ja tavoitetilan
tunnisteiden välille. Se rakentuu nykyisen sovelluksen päälle: osumat (`src/core/matrix/hits.ts`),
kartoitukset (`mapIndex`, `vogel`), Fibonacci-luvut, 369-määritelmät (`src/core/matrix/ops369.ts`), reittitestin
nollamalli ja lukitus (`src/state/matrix.ts`). Piin koordinaatteja tai koodaussääntöjä ei muuteta.

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
- **Tunnisteet** (`PathIdentifier`): nimi tai sana (T9), numerojono (raaka), päivämäärä (valittu muoto),
  tarinan henkilö (nimen T9) tai tapahtuma (päivämäärän koodi). Tekstistä poimitaan automaattisesti vain
  tarinassa tunnetut nimet täsmä- tai alkuosavastaavuudella. Käyttäjä hyväksyy ja täydentää listan.
- **Tunnetut** henkilöt, tapahtumat ja numerosarjat: sallitut välisolmut (sanasto).
- **Aikarajaus**: rajaa, mitkä tapahtumat otetaan tunnisteiksi. Piin indeksillä ei ole kalenteriaikaa, joten
  aikarajaus ei vaikuta piin indekseihin.

Jos lähtö- ja tavoitetila koodautuvat samaksi tunnistejoukoksi (esim. ”Matti ja Hanna eivät ole yhdessä” →
”Matti ja Hanna ovat yhdessä”), haku ei voi erottaa niitä. Silloin näytetään varoitus ja pyydetään
tavoitteelle oma tunniste (esim. sana tai päivämäärä).

## 2. Solmut ja sanasto

Solmu on todennettu osuma `(koodi, n)`: `digits[n − 1 … n + L − 2] === koodi`. Sanasto `V` = lähtö-, tavoite- ja
tunnettujen tunnisteiden koodit. Vain sanaston koodien osumat ovat solmuja. Koodit, joiden pituus on alle
`minCodeLength` (oletus 3), hylätään syyn kanssa, koska niillä on liikaa osumia (lyhyt koodi esiintyy
1M-aineistossa kymmeniätuhansia kertoja).

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
369-avaimen. Jokainen 369-askel lasketaan **muunnokseksi**.

## 4. Haku

- **234**: monilähteinen haku kaikista lähtösolmuista eteenpäin (tasakustannus, askeleen hinta 1, 369-askel
  1 + 1).
- **432**: monilähteinen haku kaikista tavoitesolmuista taaksepäin. Näyttää, mistä tavoitesolmuun voidaan
  päätyä.
- **Kaksisuuntainen**: molemmat vuorotellen (pienempi rintama ensin). Kun rintamat kohtaavat samassa
  solmussa, reitti = lähtöpuolen polku + tavoitepuolen polku käännettynä. Tavoitepuolen askeleet säilyttävät
  432-sääntönsä kuvauksen (esim. ”x on y:n lähin 432-osuma ennen”).
- **Budjetti**: enintään `budget` laajennettua solmua kummallekin puolelle ja `maxEdges` askelta reitissä.
  Jos budjetti loppuu, se kerrotaan.
- **Ehdokkaat**: enintään `maxRoutes` reittiä, järjestys (kustannus, muunnokset, Σ|Δn|, solmuavaimet).
  Deterministinen: sama syöte ja parametrit → sama tulos ja sama tiiviste.
- **Epäonnistuminen**: palautetaan syyt, esim. ”koodilla ei osumia”, ”koodi liian lyhyt”, ”lähtö- ja
  tavoitejoukko samat”, ”budjetti loppui”, ”rintamat eivät kohdanneet `maxEdges` askeleen sisällä”.

## 5. Parametrien lukitus

Parametrit ja kysely kanonisoidaan ja niistä lasketaan SHA-256 ennen hakua. Jokainen ajo kirjataan
tiivisteineen. Parametrien muuttaminen tulosten näkemisen jälkeen tuottaa uuden ajon, joka merkitään
eksploratiiviseksi. Monivertailun määrä näytetään.

## 6. Path Score (PIATLAS-PATHSCORE-1.0.0)

Path Score **ei ole tulevaisuuden toteutumistodennäköisyys**. Se kuvaa reitin rakennetta ja harvinaisuutta tässä
aineistossa verrattuna satunnaisaineistoon samoilla lukituilla parametreilla.

| Osa | Määritelmä |
| --- | --- |
| Harvinaisuus | p_null = (1 + #{nollareplikaatit, joissa paras reitti ≤ havaittu}) / (R + 1). Nollamallit: tasajakauma (jokaisen koodin osumamäärä säilyy, paikat arvotaan) ja siemenelliset satunnaiset 0–9-jonot. Pistemäärä min(1, −log10 p / log10(R + 1)). |
| Pituus | 1 / askeleet |
| Haarautuminen | keskimääräinen naapurimäärä b reitin solmuissa; 1 / (1 + log2 b) |
| Muunnokset | 1 / (1 + 369-askeleet) |
| Rakenne | geometristen ja numeeristen askelten osuudet (kuvaileva, ei pisteytetä) |
| Toistettavuus | sama algoritmi samoilla parametreilla tuottaa saman tulostiivisteen (kyllä/ei) |

Kokonaispistemäärä = round(100 · (0,6 · harvinaisuus + 0,15 · pituus + 0,15 · haarautuminen + 0,1 · muunnokset)),
ja 0, jos toistettavuus epäonnistuu. Ilman satunnaisvertailua kokonaispistemäärää ei anneta.

## 7. Blind Discovery (PIATLAS-BLIND-1.0.0)

Sokkotesti mittaa, tunnistaako menetelmä piilotetun todellisen tiedon.

- **Kohteet**: tapahtumat päivämäärineen (koodi = päivämäärä valitussa muodossa) tai tarinan polkujen askeleet
  (koodi = nimen T9).
- **Kierros** (leave-one-out): yksi kohde piilotetaan. Konteksti = saman joukon muut kohteet. Ehdokkaat = oikea
  vastaus + D harhautinta, joilla on **sama koodin pituus**, koska pituus määrää osumamäärän. Päivämäärien
  harhauttimet arvotaan samalta aikaväliltä, nimien harhauttimet kiinteästä suomalaisten nimien listasta.
  Siemen ja D lukitaan ennen ajoa.
- **Vuotojen esto**: piilotetun kohteen koodi, siihen liittyvät tunnisteet ja linkitetyt osumat poistetaan
  sanastosta. Ehdokkaiden järjestys sekoitetaan siemenellä, ja tasapelit ratkaistaan siemenellä.
- **Pisteytys**: jokaiselle ehdokkaalle ajetaan sama kaksisuuntainen haku konteksti → ehdokas. Ehdokkaat
  järjestetään parhaan reitin mukaan. Tulos = oikean vastauksen sijoitus.
- **Vertailu**:
  1. satunnainen valinta: sijoitus tasajakautunut, osumatarkkuus 1/(D + 1)
  2. sama algoritmi ilman piin numeroita: siemenelliset satunnaiset 0–9-jonot samalla pituudella.
- **Tulos**: jokaisen kierroksen oikea/väärä ja sijoitus, top-1-osuus, keskisijoitus, p-arvo satunnaista valintaa
  vastaan (todennäköisyys saada yhtä hyvä keskisijoitus sattumalta) ja vertailu piittömään malliin. Kaikki
  ajot tallennetaan, myös epäonnistuneet.

Vain sokkotestin tulos voi tukea väitettä, että menetelmä tunnistaa todellisia tapahtumia. Jos se on
sattuman tasolla, mikään yksittäinen löydetty reitti ei ole ennuste.
