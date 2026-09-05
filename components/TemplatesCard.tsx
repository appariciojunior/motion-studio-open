'use client';

import { useEffect, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, templateList, templateGroups, getTemplate } from '@/templates';
import type { Template } from '@/lib/types';
import TemplateThumb from './TemplateThumb';
import { ControlRow } from './Controls';
import { useMobileInteractions } from './MobileInteractions';
import { ChevronRightIcon, CloseIcon, HeartIcon, SearchIcon } from './EditorIcons';

const Chevron = ({ dir = 'right' }: { dir?: 'right' | 'left' }) => (
  <ChevronRightIcon size={12} style={dir === 'left' ? { transform: 'rotate(180deg)' } : undefined}/>
);

const Heart = ({ filled, size = 12 }: { filled: boolean; size?: number }) => (
  <HeartIcon size={size} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}/>
);

// Favourites resolve through the CATALOGUE, not the full registry: a template
// withheld from every picker must stay withheld even if it was hearted before
// it was hidden. See HIDDEN_CATALOG_GROUPS in templates/index.ts.
const catalogById = new Map(catalogTemplateList.map((t) => [t.meta.id, t]));

// The favourites shelf shares the accordion's open/closed state, so opening it
// collapses whichever family was open — one panel at a time, as before.
const FAVORITES_GROUP = 'Favorites';

// One card, used by the favourites shelf, the search results and the group
// accordion alike. It is a div rather than a button because it now nests one:
// a button inside a button is invalid markup and React will not hydrate it.
function TemplateCard({
  template,
  active,
  favorite,
  autoPreview,
  onPick,
  onToggleFavorite,
}: {
  template: Template;
  active: boolean;
  favorite: boolean;
  autoPreview?: boolean;
  onPick: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const { id, name, isNew } = template.meta;
  return (
    <div
      className={`tpl-card ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onPick(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(id);
        }
      }}
    >
      <button
        className={`icon-btn tpl-fav ${favorite ? 'on' : ''}`}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(id); }}
      >
        <Heart filled={favorite} size={14} />
      </button>
      <TemplateThumb template={template} autoPreview={autoPreview} />
      {isNew && <span className="tpl-new">NEW</span>}
      <span className="tpl-card-label">{name}</span>
    </div>
  );
}

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
  const favoriteTemplateIds = useSceneStore((s) => s.favoriteTemplateIds);
  const loadFavorites = useSceneStore((s) => s.loadFavorites);
  const toggleFavorite = useSceneStore((s) => s.toggleFavorite);
  const [tab, setTab] = useState<'templates' | 'custom'>('templates');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // board mode: the selected template's sliders are open in the left bar.
  const [showControls, setShowControls] = useState(false);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');

  // saved presets live in localStorage — pick them up after mount
  useEffect(() => {
    if (customPresetsEnabled) loadCustomPresets();
  }, [customPresetsEnabled, loadCustomPresets]);

  // Favourites are part of the catalogue, not the preset library, so they load
  // on every surface that shows templates — mobile included.
  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  // Mobile deliberately exposes only the template catalogue. Keeping this as
  // a derived value prevents custom state from leaking in if the prop changes.
  const activeTab = customPresetsEnabled ? tab : 'templates';

  const activeMeta = templateList.find((t) => t.meta.id === activeTemplateId)?.meta;

  // Select a template. In board mode this also drills into its sliders.
  const pick = (id: string) => {
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

  const isFavorite = (id: string) => favoriteTemplateIds.includes(id);
  // Kept in heart order (oldest first), and silently skipping ids the current
  // catalogue no longer publishes rather than dropping them from storage — a
  // family that comes back from hiding should bring its hearts with it.
  const favorites = favoriteTemplateIds
    .map((id) => catalogById.get(id))
    .filter((t): t is Template => Boolean(t));
  const favoritesOpen = openGroup === FAVORITES_GROUP;
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
            <SearchIcon size={13}/>
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
                      <CloseIcon size={10}/>
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
              <TemplateCard
                key={t.meta.id}
                template={t}
                active={activeTemplateId === t.meta.id}
                favorite={isFavorite(t.meta.id)}
                onPick={pick}
                onToggleFavorite={toggleFavorite}
              />
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
            {/* Favourites ride above the families, right under the search, so
                the shelf the user built is the first thing the catalogue
                offers. It stays visible when empty — that row is how the
                heart on a card is discovered in the first place. */}
            <div className={`tpl-accordion tpl-accordion-fav ${favoritesOpen ? 'open' : ''}`}>
              <button
                className={`tpl-item ${favoritesOpen ? 'active' : ''}`}
                onClick={() => setOpenGroup(favoritesOpen ? null : FAVORITES_GROUP)}
                aria-expanded={favoritesOpen}
                aria-controls="template-group-favorites"
              >
                <span className="tpl-fav-ico"><Heart filled={favorites.length > 0} /></span>
                <span className="tpl-name">{FAVORITES_GROUP}</span>
                {favorites.length > 0 && <span className="tpl-group-count">{favorites.length}</span>}
                <span className="tpl-accordion-chevron"><Chevron /></span>
              </button>
              {favoritesOpen && (
                favorites.length === 0 ? (
                  <div id="template-group-favorites" className="tpl-fav-empty">
                    Tap the heart on any template to keep it here.
                  </div>
                ) : (
                  <div id="template-group-favorites" className="tpl-grid tpl-grid-accordion">
                    {favorites.map((t) => (
                      <TemplateCard
                        key={t.meta.id}
                        template={t}
                        active={activeTemplateId === t.meta.id}
                        favorite
                        autoPreview={mobile}
                        onPick={pick}
                        onToggleFavorite={toggleFavorite}
                      />
                    ))}
                  </div>
                )
              )}
            </div>

            {templateGroups.map(({ group: name, items }) => {
              const activeHere = items.some((t) => t.meta.id === activeTemplateId);
              const isOpen = openGroup === name;
              const panelId = `template-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
              return (
                <div key={name} className={`tpl-accordion ${isOpen ? 'open' : ''}`}>
                  <button
                    className={`tpl-item ${activeHere || isOpen ? 'active' : ''}`}
                    onClick={() => setOpenGroup(isOpen ? null : name)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                  >
                    <span className="tpl-name">{name}</span>
                    {/* A family is new if any of its presets is, so the marker
                        shows on the collapsed list without opening the group. */}
                    {items.some((t) => t.meta.isNew) && <span className="tpl-new-inline">NEW</span>}
                    <span className="tpl-group-count">{items.length}</span>
                    <span className="tpl-accordion-chevron"><Chevron /></span>
                  </button>
                  {isOpen && (
                    <div id={panelId} className="tpl-grid tpl-grid-accordion">
                      {items.map((t) => (
                        <TemplateCard
                          key={t.meta.id}
                          template={t}
                          active={activeTemplateId === t.meta.id}
                          favorite={isFavorite(t.meta.id)}
                          autoPreview={mobile}
                          onPick={pick}
                          onToggleFavorite={toggleFavorite}
                        />
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
