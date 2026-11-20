import { useState } from 'react';
import { db } from '../db';
import { contactValue, personsByDepartment, personValue, pickContact, withPersonIds } from '../places';
import type { Contact, Project } from '../types';
import { patch, uid } from '../utils';
import { Field, Modal } from './ui';

type Pick3 = Pick<Project, 'contactPerson' | 'contactPersonId' | 'departmentId'>;

/**
 * Sélecteur d'interlocuteur : les personnes du client regroupées par service,
 * un service seul (sans personne précise), et l'ajout rapide d'une personne ou d'un service.
 */
export function ContactPicker({ client, value, onChange }: { client: Contact; value: Pick3; onChange: (v: Pick3) => void }) {
  const [adding, setAdding] = useState(false);
  const groups = personsByDepartment(client);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select aria-label="Interlocuteur" value={contactValue(client, value)} onChange={(e) => onChange(pickContact(client, e.target.value))}>
        <option value="">— Société ({client.company})</option>
        {groups.map((g) => (
          g.dept ? (
            <optgroup key={g.dept.id} label={`Service ${g.dept.name}`}>
              <option value={'d:' + g.dept.id}>{g.dept.name} — service, sans personne précise</option>
              {g.persons.map((p) => <option key={personValue(p)} value={personValue(p)}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
            </optgroup>
          ) : (
            <optgroup key="general" label="Sans service">
              {g.persons.map((p) => <option key={personValue(p)} value={personValue(p)}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
            </optgroup>
          )
        ))}
      </select>
      <button type="button" className="secondary small" title="Nouvel interlocuteur ou nouveau service" onClick={() => setAdding(true)}>+</button>
      {adding && <QuickPerson client={client} defaultDept={value.departmentId} onClose={(v) => { setAdding(false); if (v) onChange(v); }} />}
    </div>
  );
}

/** Ajout rapide d'un interlocuteur (et au besoin de son service) sans quitter le projet. */
function QuickPerson({ client, defaultDept, onClose }: { client: Contact; defaultDept?: string; onClose: (v?: Pick3) => void }) {
  const depts = client.departments || [];
  const [name, setName] = useState('');
  const [dept, setDept] = useState(defaultDept || '');
  const [newDept, setNewDept] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <Modal title={`Nouvel interlocuteur — ${client.company}`} onClose={() => onClose()}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const fresh = withPersonIds((await db.contacts.get(client.id)) || client);
        let departments = fresh.departments || [];
        let departmentId = dept === '__new' ? undefined : dept || undefined;
        if (dept === '__new' && newDept.trim()) {
          departmentId = uid();
          departments = [...departments, { id: departmentId, name: newDept.trim() }];
        }
        if (!name.trim()) {
          // service seul
          await patch(db.contacts, client.id, { departments });
          return onClose(departmentId ? { contactPerson: undefined, contactPersonId: undefined, departmentId } : undefined);
        }
        const person = { id: uid(), name: name.trim(), role: role.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined, departmentId };
        await patch(db.contacts, client.id, { departments, persons: [...(fresh.persons || []), person] });
        onClose({ contactPerson: person.name, contactPersonId: person.id, departmentId });
      }}>
        <Field label="Service">
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Sans service</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="__new">+ Nouveau service…</option>
          </select>
        </Field>
        {dept === '__new' && <Field label="Nom du nouveau service *"><input required autoFocus value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="ex. Communication, RH, Événementiel" /></Field>}
        <Field label="Nom de la personne">
          <input autoFocus={dept !== '__new'} value={name} onChange={(e) => setName(e.target.value)} placeholder={dept === '__new' ? 'Laisser vide pour ajouter le service seul' : ''} />
        </Field>
        <Field label="Fonction"><input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Téléphone"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => onClose()}>Annuler</button>
          <button type="submit" disabled={!name.trim() && !(dept === '__new' && newDept.trim())}>Ajouter et choisir</button>
        </div>
      </form>
    </Modal>
  );
}
