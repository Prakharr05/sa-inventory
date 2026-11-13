"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (!session) return <Login />;
  return (
    <>
      <nav className="nav">
        <a href="/inventory">Inventory</a>
        <a href="/inventory/property">+ Add</a>
        <a href="/inventory/import">Bulk add</a>
        <span className="spacer" />
        <span className="muted">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
      {children}
    </>
  );
}

function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
    }}>
      <h1>Sharma Associates</h1>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="primary">Sign in</button>
      {msg && <span className="bad">{msg}</span>}
    </form>
  );
}
