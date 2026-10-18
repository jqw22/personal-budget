# Personal Budget

A web app for importing bank transactions, tagging spending by category and budgeting ahead, with data encrypted and stored on Nostr relays.

## Using it

Open https://jqw22.github.io/personal-budget/ in your browser. The page only hosts the app's code: CSVs you import are read and stored in your own browser, never uploaded.

## Running it locally

```sh
npm install
npm run dev    # start the app at http://localhost:5173
npm test       # run the tests
```

## What works so far

- **Import** a bank statement CSV. Columns are detected automatically and can be changed. Dates without a year (like `21-May`) get their year from the card date in the description. The running balance is checked so you know the file was read correctly, and re-importing an overlapping statement skips transactions you already have.
- **Tag** each transaction with a category. With "Remember for this merchant" ticked, every other transaction from the same place is tagged the same way, now and in future imports.
- **Summary** shows income, spending by category and the under or over spend for four months, and flags anything still untagged. Transfers and Income aren't counted as spending.
- **Rules and categories** can be edited, so one rule like `HOME BARGAINS` can cover every branch.

- **Account** signs in with Nostr, using a browser extension (NIP-07) or a private key. Your budget is then encrypted to your own key with NIP-44 and saved to your relays as NIP-78 app data, one event per month plus one for categories and rules. Signing in on another device merges both copies without duplicates, and changes from other devices arrive while the app is open.

Data is always kept in your browser too. Relays only ever see encrypted data, though they can see that your key saved something for this app and which months it covers.
