# Import cen historycznych

`import-prices.ts` zapisuje do Supabase tylko `ticker`, `date` i `close`. Przyjmuje
folder i wyszukuje w nim pliki `.txt` (także w podfolderach), po jednym tickerze
na plik. Ticker bierze z nazwy pliku (np. `xtb.txt` → `XTB`); kolumna `TICKER`
w pliku jest ignorowana. Można też podać bezpośrednio pliki. Skrypt jest napisany
pod Bun i korzysta z `@supabase/supabase-js`.

## Tabela w Supabase

Wykonaj w SQL Editor:

```sql
create table if not exists public.gpw (
  ticker text not null,
  date date not null,
  close numeric not null,
  primary key (ticker, date)
);

alter table public.gpw enable row level security;
```

Klucz główny pozwala ponawiać import: para ticker/data zostanie zaktualizowana.
PostgreSQL tworzy przy nim automatycznie indeks na `(ticker, date)`, przydatny
do pobierania historii danego tickera w zakresie dat. Nie dodawaj drugiego
indeksu na tych samych kolumnach, bo dublowałby istniejący.
Polityki RLS należy dodać zgodnie z planowanym dostępem mobilnym.
`SUPABASE_SECRET_KEY` ma pełny dostęp do bazy i omija RLS. Nie umieszczaj go
w aplikacji mobilnej ani w repozytorium; używa go wyłącznie lokalny importer.

## Uruchomienie

Najpierw zainstaluj zależności projektu:

```sh
bun install
```

Skopiuj `.env.example` do `.env` i uzupełnij `SUPABASE_URL` oraz
`SUPABASE_SECRET_KEY` (wartość zaczynająca się od `sb_secret_`). Bun automatycznie wczytuje `.env` z katalogu,
w którym uruchamiasz skrypt. Plik `.env` jest ignorowany przez Git.

Potem wskaż folder z plikami:

```sh
bun run import:prices -- ./gpw gpw
```

Drugi argument to nazwa tabeli; jeśli go pominiesz, skrypt użyje
`SUPABASE_PRICES_TABLE` z `.env` albo domyślnej tabeli `gpw`. Przy wielu plikach
możesz podać tabelę jawnie przez `--table`, np.:

```sh
bun run import:prices -- ./xtb.txt ./lpp.txt --table gpw
```

Każdy plik `.txt` zawiera wiersze z kolumnami rozdzielonymi przecinkami w kolejności
`TICKER,PER,DATE,TIME,OPEN,HIGH,LOW,CLOSE,...`. Nagłówek jest opcjonalny,
a data wejściowa ma format `YYYYMMDD`. Importowane są wszystkie wiersze; dla
powtórzonej pary ticker/data wygrywa ostatni wiersz w imporcie.

Opcjonalne ustawienia: `SUPABASE_PRICES_TABLE` (domyślnie `gpw`),
`IMPORT_BATCH_SIZE` (domyślnie 500). Starsze nazwy
`SUPABASE_SERVICE_ROLE_KEY` i `SUPABASE_KEY` są nadal akceptowane.
