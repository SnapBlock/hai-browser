import { useState, type FormEvent } from 'react';

export function Contact() {
  const [sent, setSent] = useState<string>();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSent(String(form.name));
  };
  return (
    <div className="container page contact">
      <div>
        <h1>Get in touch</h1>
        <p className="lede">Questions about an order, wholesale, or which coffee to try next? We reply within one working day.</p>
        <div className="visit">
          <h3>Café &amp; roastery</h3>
          <p>
            2210 SE Division St
            <br />
            Portland, OR 97202
          </p>
          <p>Open daily 7am–4pm</p>
        </div>
      </div>
      {sent ? (
        <div className="card thanks">
          <h2>Thanks, {sent}!</h2>
          <p>Your message is on its way. We'll get back to you soon.</p>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <label className="field">
            Name
            <input name="name" required />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <label className="field">
            Topic
            <select name="topic" defaultValue="Order question">
              <option>Order question</option>
              <option>Wholesale</option>
              <option>Subscriptions</option>
              <option>Visiting the café</option>
              <option>Something else</option>
            </select>
          </label>
          <label className="field">
            Message
            <textarea name="message" rows={5} required />
          </label>
          <button type="submit" className="button">
            Send message
          </button>
        </form>
      )}
    </div>
  );
}
