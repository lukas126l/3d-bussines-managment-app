# Forma — sprzedaż 3D

Prosty panel do prowadzenia sprzedaży wydruków 3D. Dane w tej pierwszej wersji są zapisywane lokalnie w przeglądarce.

## Uruchomienie

Otwórz `index.html` w przeglądarce lub uruchom dowolny lokalny serwer statyczny w tym folderze.

## Zakres pierwszej wersji

- Pulpit: przychód, koszty, zysk, sprzedane sztuki oraz porównanie miesięczne.
- Sprzedaż: klient, produkt, kanał, data, kwota, status i wysyłka.
- Produkty: katalog projektów drukowanych na zamówienie oraz ceny bazowe.
- Koszty oraz kanały sprzedaży.

Przed publikacją online warto podłączyć bazę danych i logowanie, aby dane były dostępne na różnych urządzeniach.

## Publikacja na GitHub Pages

Projekt jest gotowy do automatycznej publikacji na GitHub Pages. Po utworzeniu repozytorium i wysłaniu plików:

1. W repozytorium otwórz **Settings → Pages**.
2. Przy **Source** wybierz **GitHub Actions**.
3. Workflow „Publikuj Forma 3D” opublikuje aplikację po każdym wysłaniu zmian na gałąź `main`.

Po publikacji aplikacja działa jako PWA: na iPhonie wybierz w Safari **Udostępnij → Do ekranu początkowego**, a na Androidzie w Chrome **Zainstaluj aplikację**.
