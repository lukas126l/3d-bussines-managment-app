# Forma — sprzedaż 3D

Prosty panel do prowadzenia sprzedaży wydruków 3D z bezpieczną synchronizacją danych przez Supabase.

## Uruchomienie

Otwórz `index.html` w przeglądarce lub uruchom dowolny lokalny serwer statyczny w tym folderze.

## Zakres pierwszej wersji

- Pulpit: przychód, koszty, zysk, sprzedane sztuki oraz porównanie miesięczne.
- Sprzedaż: produkty, kanał, data, kwota, status i wysyłka.
- Produkty: katalog projektów drukowanych na zamówienie oraz ceny bazowe.
- Koszty oraz kanały sprzedaży.

## Synchronizacja danych

Jednorazowo uruchom zawartość pliku `supabase/schema.sql` w panelu **SQL Editor** swojego projektu Supabase. Plik tworzy jedną tabelę danych oraz reguły, dzięki którym każdy zalogowany użytkownik ma dostęp wyłącznie do własnych wpisów.

## Publikacja na GitHub Pages

Po utworzeniu repozytorium i wysłaniu plików:

1. W repozytorium otwórz **Settings → Pages**.
2. Przy **Source** wybierz **Deploy from a branch**.
3. Wybierz gałąź `main` oraz folder `/(root)`.

Po publikacji aplikacja działa jako PWA: na iPhonie wybierz w Safari **Udostępnij → Do ekranu początkowego**, a na Androidzie w Chrome **Zainstaluj aplikację**.

Jeżeli zainstalowana wersja nie pobiera najnowszego interfejsu, wybierz w jej ustawieniach „Napraw aktualizację aplikacji”. Uruchom naprawę w aplikacji z ikonki, jeśli problem występuje właśnie tam: Safari i aplikacja na ekranie początkowym iOS mają oddzielną pamięć. Naprawa czyści wyłącznie pliki tymczasowe aplikacji, zachowując dane zapisane lokalnie i online.

Service worker przechowuje wyłącznie znane pliki aplikacji. Zapytania do Supabase i zewnętrzne skrypty omijają tę pamięć; aktualizacja usuwa poprzednie cache `forma-3d-*`, w tym zapisane przez starsze wersje odpowiedzi API.

## Koszty produkcji i rentowność

W produkcie wpisz zużycie filamentu z odpadami (g/szt.), czas druku (godziny dziesiętne), cenę filamentu za kg oraz dodatki na sztukę. Domyślna stawka Bambu Lab A1 wynosi 0,60 zł/h (szacunkowo prąd 0,15 zł i rezerwa eksploatacyjna 0,45 zł); można ją zmienić przy produkcie.

Koszt sztuki = gramy / 1000 × cena kg + godziny × stawka + dodatki. Sprzedaż zapisuje koszt sztuki na każdej pozycji. Zmiany katalogu nie zmieniają zapisanych kosztów; edycja ilości korzysta z historycznej stawki. Brakujące koszty można uzupełnić przez zapis sprzedaży po uzupełnieniu produktu.

Zysk zamówienia = kwota sprzedaży − koszt produkcji wszystkich sztuk − wpisane opłaty i wysyłka po naszej stronie. Marża = zysk / kwota sprzedaży × 100%; przy kwocie zero pokazujemy kreskę. Wynik jest przed podatkiem i kosztami ogólnymi; dla aktywnych, niezakończonych zamówień jest prognozą. Nie wpisuj opakowania drugi raz, jeśli jest już w dodatkach produktu.

Pulpit nadal pokazuje wpływy z zakończonych sprzedaży minus zarejestrowane wydatki. Nie odejmuje ponownie kosztów produkcji, ponieważ zakupy materiałów mogą już być wpisane w wydatkach.

Produkty i sprzedaż mają przycisk „Podgląd” z widokiem tylko do odczytu. Podgląd produktu pokazuje marżę dla ceny bazowej i cen kanałowych, przed opłatami sprzedaży. Starsze zamówienia bez zapisanego kosztu korzystają z aktualnych parametrów produktu; wyliczenie nie dopisuje kosztu do historii zamówienia. Sam podgląd nie zapisuje ani nie zmienia danych zamówienia.

Marża wybranego okresu w analizie sprzedaży to łączny zysk zakończonych zamówień / łączny przychód tych zamówień × 100%. Koszt obejmuje produkcję, dodatki oraz opłaty sprzedaży i wysyłkę wpisane przy zamówieniu. Nie odejmujemy ponownie zakupów z zakładki Koszty. Brak kosztów którejkolwiek zakończonej sprzedaży oznacza brak pełnego wyniku, a nie zerowy koszt.
