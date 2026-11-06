import { icons, glyph } from '../icons';

export const appMarkup = /* HTML */ ` <aside>
    <div class="brand" aria-label="ADBShare">
      <span class="brand-icon">${glyph}</span>
      <div>ADBShare<small data-i18n="tagline"></small></div>
    </div>
    <button id="group-entry" class="flat-nav">
      ${icons.groups}<span data-i18n="groups"></span
      ><span id="group-count" class="nav-count">0</span>
    </button>
    <nav id="groups" aria-label="Groups"></nav>
    <button id="new-bottom" class="new-group">
      <span aria-hidden="true">＋</span> <span data-i18n="newGroup"></span>
    </button>
    <div class="side-bottom">
      <button id="device-entry" class="flat-nav" aria-haspopup="dialog" aria-expanded="false">
        ${icons.devices}<span id="adb-status" data-i18n="localDevices"></span
        ><span id="device-count" class="nav-count">0</span>
      </button>
      <button id="history-entry" class="flat-nav" aria-haspopup="dialog" aria-expanded="false">
        ${icons.logs}<span data-i18n="logs"></span>
      </button>
      <button id="settings" class="flat-nav" aria-haspopup="dialog" aria-expanded="false">
        ${icons.settings}<span data-i18n="settings"></span>
      </button>
      <div class="utility-bar">
        <button id="language-toggle" class="square-button">${icons.language}</button>
        <button id="theme-toggle" class="square-button"></button>
        <button id="about" class="square-button" aria-haspopup="dialog" aria-expanded="false">
          ${icons.info}
        </button>
        <button
          id="help"
          class="square-button"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-keyshortcuts="F1"
        >
          ${icons.help}
        </button>
      </div>
    </div>
  </aside>
  <main>
    <header id="editor-header" hidden>
      <div class="editor-title">
        <h1 id="title" data-i18n="groupConfig"></h1>
        <span id="group-state" class="badge"></span>
      </div>
      <div class="editor-actions">
        <button id="delete-group" class="danger-button" data-i18n="deleteGroup"></button
        ><button id="save" class="secondary" data-i18n="save"></button
        ><button id="toggle" class="primary"></button>
      </div>
    </header>
    <div id="notice" role="status" hidden></div>
    <section id="welcome" class="welcome">
      <div class="welcome-icon">${glyph}</div>
      <h2 data-i18n="welcomeTitle"></h2>
      <p class="welcome-description" data-i18n="welcomeDescription"></p>
      <div class="welcome-steps">
        <span><b>01</b><span data-i18n="selectDevices"></span></span
        ><span><b>02</b><span data-i18n="endpoint"></span></span
        ><span><b>03</b><span data-i18n="remoteUse"></span></span>
      </div>
    </section>
    <section id="workspace" hidden>
      <div class="columns">
        <div class="configuration">
          <section class="card">
            <div class="section-head">
              <span class="step">01</span>
              <div>
                <h2 data-i18n="selectDevices"></h2>
                <p data-i18n="deviceHint"></p>
              </div>
              <span id="member-count" class="count"></span>
            </div>
            <div id="devices"></div>
          </section>
          <section class="card">
            <div class="section-head">
              <span class="step">02</span>
              <div>
                <h2 data-i18n="endpoint"></h2>
                <p data-i18n="endpointHint"></p>
              </div>
            </div>
            <div class="form">
              <label
                ><span data-i18n="name"></span
                ><input id="group-name" maxlength="60" data-placeholder="namePlaceholder"
              /></label>
              <div class="form-row">
                <label
                  ><span data-i18n="adapter"></span
                  ><select id="address"></select></label
                ><label class="port"
                  ><span data-i18n="port"></span><input id="port" type="number" min="1" max="65535"
                /></label>
              </div>
              <label
                ><span data-i18n="sources"></span
                ><textarea
                  id="sources"
                  rows="2"
                  data-placeholder="sourcesPlaceholder"
                  aria-describedby="source-hint source-warning"
                ></textarea>
              </label>
              <p id="source-hint" class="field-help" data-i18n="sourceHint"></p>
              <p
                id="source-warning"
                class="field-help source-warning"
                role="status"
                data-i18n="nonLocalSourceWarning"
                hidden
              ></p>
            </div>
            <div id="firewall-controls" class="firewall-bar" hidden>
              <span data-i18n="firewall"></span
              ><button id="firewall-add" class="secondary" data-i18n="firewallAdd"></button
              ><button id="firewall-remove" class="secondary" data-i18n="firewallRemove"></button>
            </div>
            <p
              id="external-firewall-hint"
              class="field-help"
              data-i18n="externalFirewallHint"
              hidden
            ></p>
          </section>
        </div>
        <div class="details">
          <section class="card connect-card">
            <div class="section-head">
              <span class="step">03</span>
              <div>
                <h2 data-i18n="remoteUse"></h2>
                <p data-i18n="remoteHint"></p>
              </div>
            </div>
            <div id="connection"></div>
            <div class="form">
              <p class="field-help" data-i18n="portMappingUnsupported"></p>
            </div>
          </section>
          <section class="card">
            <div class="section-head compact">
              <h2 data-i18n="connections"></h2>
              <span id="session-count" class="count">0</span>
            </div>
            <div id="sessions"></div>
          </section>
        </div>
      </div>
    </section>

    <footer id="adb-warning" role="status" hidden>
      ${icons.info}<span data-i18n="adbStartupHint"></span
      ><button id="adb-warning-settings" class="secondary" data-i18n="openSettings"></button>
    </footer>
  </main>
  <dialog id="history-dialog" class="history-dialog">
    <div class="dialog-heading">
      <h2 data-i18n="logs"></h2>
      <button id="close-history" class="square-button close-button">${icons.close}</button>
    </div>
    <div class="history-filters">
      <label
        ><span data-i18n="historyScope"></span
        ><select id="history-group"></select></label
      ><label
        ><span data-i18n="historyDevice"></span
        ><select id="history-device"></select
      ></label>
    </div>
    <div id="history-status"></div>
    <div id="history-overview"></div>
    <div class="history-toolbar">
      <span id="history-count" class="quiet"></span>
      <div>
        <button id="history-copy" class="secondary" data-i18n="copyHistory"></button
        ><button id="history-export" class="secondary" data-i18n="exportHistory"></button
        ><button id="history-reset" class="danger-button" data-i18n="resetHistory"></button>
      </div>
    </div>
    <p id="history-feedback" role="status" class="quiet"></p>
    <p id="history-limits" class="field-help"></p>
    <pre id="history-records" tabindex="0"></pre>
    <p id="config-path" class="quiet"></p>
  </dialog>
  <dialog id="settings-dialog">
    <form id="settings-form">
      <div class="dialog-heading">
        <h2 data-i18n="settings"></h2>
        <button type="button" id="close-settings" class="square-button close-button">
          ${icons.close}
        </button>
      </div>
      <p class="quiet" data-i18n="settingsHint"></p>
      <p id="linux-adb-hint" class="field-help" data-i18n="linuxAdbHint" hidden></p>
      <label
        ><span data-i18n="adbPath"></span
        ><input id="adb-path" data-placeholder="adbPathPlaceholder" /></label
      ><label
        ><span data-i18n="upstreamPort"></span
        ><input id="upstream-port" type="number" min="1" max="65535"
      /></label>
      <p class="field-help" data-i18n="settingsPortHint"></p>
      <div class="dialog-actions">
        <button type="button" id="start-adb" class="secondary" data-i18n="startAdb"></button
        ><button type="submit" class="primary" data-i18n="save"></button>
      </div>
    </form>
  </dialog>
  <dialog id="local-devices-dialog" class="wide-dialog">
    <div class="dialog-heading">
      <h2><span data-i18n="localDevices"></span> <span id="local-count" class="count"></span></h2>
      <div class="header-actions">
        <button id="local-refresh" class="secondary" data-i18n="refresh"></button
        ><button id="close-devices" class="square-button close-button">${icons.close}</button>
      </div>
    </div>
    <div id="local-device-list"></div>
  </dialog>
  <dialog id="about-dialog" class="wide-dialog">
    <div class="dialog-heading">
      <h2 data-i18n="about"></h2>
      <button id="close-about" class="square-button close-button">${icons.close}</button>
    </div>
    <div class="about-tabs">
      <button data-tab="overview" data-i18n="overview"></button
      ><button data-tab="project" data-i18n="projectLicense"></button
      ><button id="third-party-tab" data-tab="thirdParty" data-i18n="thirdParty"></button>
    </div>
    <div id="about-summary"></div>
    <div
      id="third-party-components"
      hidden
      tabindex="0"
      role="region"
      aria-labelledby="third-party-tab"
    ></div>
    <pre id="license-document" hidden tabindex="0" lang="en"></pre>
  </dialog>
  <dialog id="help-dialog" class="help-dialog" aria-labelledby="help-title">
    <div class="help-header">
      <div class="dialog-heading">
        <h2 id="help-title" data-i18n="help"></h2>
        <button id="close-help" class="square-button close-button">${icons.close}</button>
      </div>
      <div id="help-tabs" class="about-tabs" role="tablist" aria-label="Help">
        <button
          id="help-guide-tab"
          role="tab"
          data-help-tab="guide"
          aria-controls="help-guide"
          data-i18n="helpGuide"
        ></button>
        <button
          id="help-commands-tab"
          role="tab"
          data-help-tab="commands"
          aria-controls="help-commands"
          data-i18n="helpCommands"
        ></button>
        <button
          id="help-differences-tab"
          role="tab"
          data-help-tab="differences"
          aria-controls="help-differences"
          data-i18n="helpDifferences"
        ></button>
      </div>
    </div>
    <div id="help-content" class="help-content" tabindex="0">
      <section id="help-guide" role="tabpanel" aria-labelledby="help-guide-tab"></section>
      <section
        id="help-commands"
        role="tabpanel"
        aria-labelledby="help-commands-tab"
        hidden
      ></section>
      <section
        id="help-differences"
        role="tabpanel"
        aria-labelledby="help-differences-tab"
        hidden
      ></section>
    </div>
  </dialog>
  <dialog id="confirm-dialog">
    <h2 id="confirm-title"></h2>
    <p id="confirm-text"></p>
    <div class="dialog-actions">
      <button id="confirm-no" class="secondary" data-i18n="cancel"></button
      ><button id="confirm-yes" class="primary" data-i18n="confirm"></button>
    </div>
  </dialog>
  <dialog id="shutdown-dialog">
    <h2 id="shutdown-title"></h2>
    <p id="shutdown-text"></p>
    <div id="shutdown-actions" class="dialog-actions" hidden>
      <button id="shutdown-back" class="secondary" data-i18n="back"></button
      ><button id="shutdown-retry" class="primary" data-i18n="retryExit"></button>
    </div>
  </dialog>`;
