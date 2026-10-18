# Personal Budget

A web app for importing bank transactions, tagging spending by category and budgeting ahead, with data encrypted and stored on Nostr relays.

## Running it

```sh
npm install
npm run dev    # start the app at http://localhost:5173
npm test       # run the tests
```

## What works so far

- **Import** a bank statement CSV. Columns are detected automatically and can be changed. Dates without a year (like `21-May`) get their year from the card date in the description. The running balance is checked so you know the file was read correctly, and re-importing an overlapping statement skips transactions you already have.
- **Tag** each transaction with a category. With "Remember for this merchant" ticked, every other transaction from the same place is tagged the same way, now and in future imports.
- **Rules and categories** can be edited, so one rule like `HOME BARGAINS` can cover every branch.

Data is saved in your browser for now. Encrypted storage on Nostr relays comes in a later step.
