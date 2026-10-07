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

Jeżeli zainstalowana wersja nie pobiera najnowszego interfejsu, otwórz w Safari adres `odswiez.html` w katalogu aplikacji. Czyści on wyłącznie pliki tymczasowe aplikacji, zachowując dane zapisane lokalnie i online.
