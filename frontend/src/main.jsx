import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context.jsx';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { failed:false };
  static getDerivedStateFromError() {return {failed:true};}
  render() {
    if (this.state.failed) return <main className="fatal-error"><h1>The workspace could not be displayed.</h1><p>Reload the page to try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Reload workspace</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><AppProvider><App /></AppProvider></ErrorBoundary></React.StrictMode>);
