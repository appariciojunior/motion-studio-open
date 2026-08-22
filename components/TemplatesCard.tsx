'use client';

import { useEffect, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, templateList, templateGroups, getTemplate } from '@/templates';
import TemplateThumb from './TemplateThumb';
import { ControlRow } from './Controls';
import { useMobileInteractions } from './MobileInteractions';
import { markTemplateIdsSeen, readSeenTemplateIds } from '@/lib/templateNovelty';

const Chevron = ({ dir = 'right' }: { dir?: 'right' | 'left' }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={dir === 'left' ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// `controlsInline` adds a third drill level — Group ▸ Template ▸ Sliders —
// used by board mode, which has no middle column to show a template's own
// controls in. Selecting a template opens its sliders right here, over the same
// left bar, keeping the search and back that already exist. Off (2D/web), the
// card behaves exactly as before: selecting only sets the active template.
export default function TemplatesCard({
  controlsInline = false,
  onSelect,
  customPresetsEnabled = true,
}: {
  controlsInline?: boolean;
  onSelect?: () => void;
  customPresetsEnabled?: boolean;
}) {
  const mobile = useMobileInteractions();
  const activeTemplateId = useSceneStore((s) => s.activeTemplateId);
  const setActiveTemplate = useSceneStore((s) => s.setActiveTemplate);
  const values = useSceneStore((s) => s.values);
  const setValue = useSceneStore((s) => s.setValue);
  const customPresets = useSceneStore((s) => s.customPresets);
  const loadCustomPresets = useSceneStore((s) => s.loadCustomPresets);
  const saveCustomPreset = useSceneStore((s) => s.saveCustomPreset);
  const applyCustomPreset = useSceneStore((s) => s.applyCustomPreset);
  const deleteCustomPreset = useSceneStore((s) => s.deleteCustomPreset);
  const [tab, setTab] = useState<'templates' | 'custom'>('templates');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // board mode: the selected template's sliders are open in the left bar.
  const [showControls, setShowControls] = useState(false);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [seenTemplateIds, setSeenTemplateIds] = useState<Set<string>>(new Set());
  const [noveltyReady, setNoveltyReady] = useState(false);

  // saved presets live in localStorage — pick them up after mount
  useEffect(() => {
    if (customPresetsEnabled) loadCustomPresets();
  }, [customPresetsEnabled, loadCustomPresets]);

  useEffect(() => {
    setSeenTemplateIds(readSeenTemplateIds());
    setNoveltyReady(true);
  }, []);

  // Mobile deliberately exposes only the template catalogue. Keeping this as
  // a derived value prevents custom state from leaking in if the prop changes.
  const activeTab = customPresetsEnabled ? tab : 'templates';

  const activeMeta = templateList.find((t) => t.meta.id === activeTemplateId)?.meta;

  // Select a template. In board mode this also drills into its sliders.
  const markSeen = (ids: Iterable<string>) => {
    setSeenTemplateIds(markTemplateIdsSeen(ids));
  };

  const isUnseen = (template: (typeof catalogTemplateList)[number]) =>
    noveltyReady && !!template.meta.isNew && !seenTemplateIds.has(template.meta.id);

  const pick = (id: string) => {
    markSeen([id]);
    setActiveTemplate(id);
    if (controlsInline) setShowControls(true);
    onSelect?.();
  };

  const pickCustom = (id: string) => {
    applyCustomPreset(id);
    onSelect?.();
  };

  const commitPreset = () => {
    const name = presetName.trim() || `${activeMeta?.name ?? 'Preset'} custom`;
    saveCustomPreset(name);
    setNaming(false);
    setPresetName('');
    setTab('custom');
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matches = catalogTemplateList.filter(
    (t) => t.meta.name.toLowerCase().includes(q) || t.meta.group.toLowerCase().includes(q)
  );
  return (
    <section className="card templates">
      <div className="tpl-head">
        <div className="tpl-head-row">
          {customPresetsEnabled && (
            <div className="tabs">
              <button className={`tab ${activeTab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>Templates</button>
              <button className={`tab ${activeTab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>Custom</button>
            </div>
          )}
        </div>

        <div className="searchbox">
          <span className="ico">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </span>
          <input placeholder={`Search ${catalogTemplateList.length} templates`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="tpl-list">
        {activeTab === 'custom' ? (
          customPresets.length === 0 ? (
            <div className="tpl-group-label">No custom presets yet</div>
          ) : (
            <div className="tpl-grid">
              {customPresets.map((p) => {
                const base = templateList.find((t) => t.meta.id === p.templateId);
                return (
                  <div
                    key={p.id}
                    className="tpl-card tpl-card-custom"
                    role="button"
                    tabIndex={0}
                    onClick={() => pickCustom(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pickCustom(p.id);
                      }
                    }}
                  >
                    {base && <TemplateThumb template={base} />}
                    <span className="tpl-card-label">{p.name}</span>
                    <button
                      className="icon-btn tpl-del"
                      title="Delete preset"
                      onClick={(e) => { e.stopPropagation(); deleteCustomPreset(p.id); }}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : searching ? (
          // flat results across all groups while searching
          <div className="tpl-grid">
            {matches.map((t) => (
              <button
                key={t.meta.id}
                className={`tpl-card ${activeTemplateId === t.meta.id ? 'active' : ''}`}
                onClick={() => pick(t.meta.id)}
              >
                <TemplateThumb template={t} />
                {isUnseen(t) && <span className="tpl-new">Novo</span>}
                <span className="tpl-card-label">{t.meta.name}</span>
              </button>
            ))}
          </div>
        ) : controlsInline && showControls ? (
          // board mode third level: the selected template's own sliders
          <>
            <div className="tpl-group-head">
              <button className="tpl-back" onClick={() => setShowControls(false)}>
                <Chevron dir="left" />
              </button>
              <span className="tpl-group-title">{activeMeta?.name ?? 'Controls'}</span>
            </div>
            <div className="section-body">
              {getTemplate(activeTemplateId).controls
                // count is owned by the board (its Cards slider), not the template
                .filter((def) => def.key !== 'count')
                .map((def) => (
                  <ControlRow
                    key={def.key}
                    def={def}
                    value={values[def.key]}
                    onChange={(val) => setValue(def.key, val)}
                  />
                ))}
            </div>
          </>
        ) : (
          // Accordion: keep catalogue context while showing one group's models.
          <>
            {templateGroups.map(({ group: name, items }) => {
              const activeHere = items.some((t) => t.meta.id === activeTemplateId);
              const isOpen = openGroup === name;
              const panelId = `template-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
              return (
                <div key={name} className={`tpl-accordion ${isOpen ? 'open' : ''}`}>
                  <button
                    className={`tpl-item ${activeHere || isOpen ? 'active' : ''}`}
                    onClick={() => {
                      if (!isOpen) markSeen(items.filter((t) => t.meta.isNew).map((t) => t.meta.id));
                      setOpenGroup(isOpen ? null : name);
                    }}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                  >
                    <span className="tpl-name">{name}</span>
                    {/* A family is new if any of its presets is, so the marker
                        shows on the collapsed list without opening the group. */}
                    {items.some(isUnseen) && <span className="tpl-new-inline">Novo</span>}
                    <span className="tpl-accordion-chevron"><Chevron /></span>
                  </button>
                  {isOpen && (
                    <div id={panelId} className="tpl-grid tpl-grid-accordion">
                      {items.map((t) => (
                        <button
                          key={t.meta.id}
                          className={`tpl-card ${activeTemplateId === t.meta.id ? 'active' : ''}`}
                          onClick={() => pick(t.meta.id)}
                        >
                          <TemplateThumb template={t} autoPreview={mobile} />
                          {isUnseen(t) && <span className="tpl-new">Novo</span>}
                          <span className="tpl-card-label">{t.meta.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {customPresetsEnabled && (
        <div className="tpl-foot">
          {naming ? (
            <div className="tpl-save-row">
              <input
                className="field"
                autoFocus
                placeholder={`${activeMeta?.name ?? 'Preset'} custom`}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPreset();
                  if (e.key === 'Escape') { setNaming(false); setPresetName(''); }
                }}
              />
              <button className="btn solid" onClick={commitPreset}>Save</button>
            </div>
          ) : (
            <button className="btn full" onClick={() => setNaming(true)}>Save as custom</button>
          )}
        </div>
      )}
    </section>
  );
}
