import { createContext, useContext, useEffect, useReducer, useState } from 'react';
import { api, allRows, localId } from './lib.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [revision, refresh] = useReducer(value => value + 1, 0);
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [hash, setHash] = useState(window.location.hash || '#/overview');
  useEffect(() => {
    const change = () => setHash(window.location.hash || '#/overview');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts(previous => previous.slice(1)), 5500);
    return () => clearTimeout(timer);
  }, [toasts]);
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const toast = (message, type = 'success') => setToasts(previous => [...previous.slice(-2), { id: localId(), message, type }]);
  const navigate = value => { window.location.hash = `/${value}`; };
  const done = message => { refresh(); setModal(null); toast(message); };
  return <AppContext.Provider value={{ revision, refresh, modal, setModal, toasts, setToasts, toast, done, navigate,
    page: path || 'overview', params: new URLSearchParams(query) }}>{children}</AppContext.Provider>;
}

export function useApi(path) {
  const { revision } = useApp();
  const [retry, reload] = useReducer(value => value + 1, 0);
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null });
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    api(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ data, loading: false, error: null }); })
      .catch(error => { if (!controller.signal.aborted) setState({ data: null, loading: false, error }); });
    return () => controller.abort();
  }, [path, revision, retry]);
  return { ...state, reload };
}

export function useAll(path) {
  const { revision } = useApp();
  const [retry, reload] = useReducer(value => value + 1, 0);
  const [state, setState] = useState({ data: [], loading: Boolean(path), error: null });
  useEffect(() => {
    if (!path) { setState({ data: [], loading: false, error: null }); return; }
    const controller = new AbortController();
    setState({ data: [], loading: true, error: null });
    allRows(path, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ data, loading: false, error: null }); })
      .catch(error => { if (!controller.signal.aborted) setState({ data: [], loading: false, error }); });
    return () => controller.abort();
  }, [path, revision, retry]);
  return { ...state, reload };
}
