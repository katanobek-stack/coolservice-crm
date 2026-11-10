import { useEffect, useMemo, useState } from 'react';
import { listenCashflow } from '../../shared/firebase/cashflow';
import { validateCashflowEntry, type CashflowAccount, type CashflowEntry } from './cashflowLogic';

export function useCashflow() {
  const [accounts, setAccounts] = useState<CashflowAccount[]>([]), [entries, setEntries] = useState<CashflowEntry[]>([]);
  const [accountsReady, setAccountsReady] = useState(false), [entriesReady, setEntriesReady] = useState(false);
  const [accountError, setAccountError] = useState(''), [entryError, setEntryError] = useState(''), [revision, retry] = useState(0);
  useEffect(() => {
    setAccountsReady(false); setEntriesReady(false); setAccountError(''); setEntryError('');
    return listenCashflow(a => { setAccounts(a); setAccountsReady(true); setAccountError(''); }, e => { setEntries(e); setEntriesReady(true); setEntryError(''); }, (message, source) => {
      if (source === 'accounts') { setAccountsReady(false); setAccountError(message); }
      else { setEntriesReady(false); setEntryError(message); }
    });
  }, [revision]);
  const invalid = useMemo(() => {
    if (!accountsReady || !entriesReady) return '';
    try { entries.forEach(entry => validateCashflowEntry(entry, accounts)); return ''; }
    catch { return 'В журнале есть некорректные операции. Итоги и экспорт недоступны до проверки данных.'; }
  }, [accounts, entries, accountsReady, entriesReady]);
  return { accounts, entries, ready: accountsReady && entriesReady && !invalid, error: accountError || entryError || invalid, retry: () => retry(n => n + 1) };
}
