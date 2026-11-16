import QtQuick
import QtQuick.Window
import QtWebEngine
import org.kde.plasma.plasmoid
import org.kde.taskmanager as TaskManager

WallpaperItem {
    id: root

    // This plugin's version (the same as metadata.json; the build checks it). The page compares it
    // with the version it needs and shows "plugin update available" on the weather card if it is older.
    readonly property string hostVersion: "1.2.1"
    readonly property string quality: root.configuration.Quality === "low" ? "low" : "auto"
    readonly property int fps: Math.max(5, Math.min(30, Number(root.configuration.FrameRate) || 15))
    readonly property string onlineUrl: "https://damirlukina88.github.io/live-zagreb-wallpaper/"
    readonly property string bundledUrl: Qt.resolvedUrl("../web/index.html")

    // ------------------------------------------------------------------
    // Multi-display geometry. Plasma runs one wallpaper per display; in span mode each page is told
    // where its display sits on the desktop and which display carries the scene.
    // ------------------------------------------------------------------
    function rectStr(r) {
        return Math.round(r.x) + "," + Math.round(r.y) + "," + Math.round(r.w) + "," + Math.round(r.h);
    }

    readonly property var layoutInfo: {
        var screens = Qt.application.screens;
        // Height alignment (per display): + moves this display's part of the picture up
        var nudge = Number(root.configuration.HeightOffset) || 0;
        var mine = { x: Screen.virtualX, y: Screen.virtualY + nudge, w: Screen.width, h: Screen.height };
        if ((root.configuration.Layout || "clone") !== "span" || screens.length === 0) {
            return { layout: "clone" };
        }
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var want = root.configuration.SceneDisplay || "";
        var scene = null, primary = null;
        for (var i = 0; i < screens.length; ++i) {
            var s = screens[i];
            var r = { x: s.virtualX, y: s.virtualY, w: s.width, h: s.height };
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
            if (want !== "" && s.name === want) scene = r;
            // Qt lists the primary display (KDE's "main display", the top one in Display Configuration) first
            if (i === 0) primary = r;
        }
        if (!scene) scene = primary;
        // The scene display is the reference: alignment only moves the displays beside it
        if (scene.x === Screen.virtualX && scene.y === Screen.virtualY) mine.y = Screen.virtualY;
        var shift = function (r) { return { x: r.x - minX, y: r.y - minY, w: r.w, h: r.h }; };
        return {
            layout: "span",
            view: shift(mine),
            desk: { w: maxX - minX, h: maxY - minY },
            scene: shift(scene)
        };
    }

    function getConfigJson() {
        var info = root.layoutInfo;
        var cfg = {
            city: root.configuration.City || "Zagreb",
            lang: root.configuration.Language || "hr",
            quality: root.quality,
            animBattery: !!root.configuration.AnimateOnBattery,
            fps: root.fps,
            layout: info.layout
        };
        if (info.layout === "span") {
            cfg.view = info.view;
            cfg.desk = info.desk;
            cfg.scene = info.scene;
        }
        return JSON.stringify(cfg);
    }

    function getHash() {
        var c = root.configuration.City || "Zagreb";
        var l = root.configuration.Language || "hr";
        var h = "city=" + encodeURIComponent(c) + "&lang=" + encodeURIComponent(l) + "&quality=" + root.quality
            + "&animbattery=" + (root.configuration.AnimateOnBattery ? "1" : "0") + "&fps=" + root.fps + "&host=kde-" + root.hostVersion;
        var info = root.layoutInfo;
        h += "&layout=" + info.layout;
        if (info.layout === "span") {
            h += "&view=" + rectStr(info.view) + "&desk=" + Math.round(info.desk.w) + "," + Math.round(info.desk.h)
                + "&scene=" + rectStr(info.scene);
        }
        return h;
    }

    function pushSettings() {
        if (web && web.loading === false) {
            web.runJavaScript("if (window.wallpaperSettings) window.wallpaperSettings(" + root.getConfigJson() + ");");
        }
    }

    function pushPaused() {
        if (web && web.loading === false) {
            web.runJavaScript("if (window.wallpaperPaused) window.wallpaperPaused(" + (root.isCovered ? "true" : "false") + ");");
        }
    }

    onLayoutInfoChanged: pushSettings()

    // ------------------------------------------------------------------
    // Mains or battery: on battery the page does not animate (unless the user allows it)
    // ------------------------------------------------------------------
    // The data source lives in an optional module, so it is created at run time: without it the
    // page falls back to the browser's own battery information, or assumes mains power.
    property var powerSource: null
    property bool onBattery: false

    function pushPower() {
        if (root.powerSource && web && web.loading === false) {
            web.runJavaScript("if (window.wallpaperPower) window.wallpaperPower(" + (root.onBattery ? "true" : "false") + ");");
        }
    }

    function readPower() {
        var d = root.powerSource && root.powerSource.data ? root.powerSource.data["AC Adapter"] : null;
        if (d && d["Plugged in"] !== undefined) root.onBattery = !d["Plugged in"];
    }

    onOnBatteryChanged: pushPower()

    Component.onCompleted: {
        coverCheck.restart();
        try {
            root.powerSource = Qt.createQmlObject(
                'import org.kde.plasma.plasma5support as P5Support\n'
                + 'P5Support.DataSource { engine: "powermanagement"; connectedSources: ["AC Adapter"] }',
                root, "powerSource");
            root.powerSource.dataChanged.connect(root.readPower);
            root.readPower();
        } catch (e) {
            console.warn("Skill Issue wallpaper: no power information, assuming mains:", e);
        }
    }

    // ------------------------------------------------------------------
    // Pause while fullscreen or maximized windows cover this display (or any display, by setting)
    // ------------------------------------------------------------------
    TaskManager.VirtualDesktopInfo { id: desktopInfo }
    TaskManager.ActivityInfo { id: activityInfo }

    TaskManager.TasksModel {
        id: tasks
        groupMode: TaskManager.TasksModel.GroupDisabled
        screenGeometry: Qt.rect(Screen.virtualX, Screen.virtualY, Screen.width, Screen.height)
        filterByScreen: (root.configuration.PauseRule || "screen") !== "all"
        virtualDesktop: desktopInfo.currentDesktop
        filterByVirtualDesktop: true
        activity: activityInfo.currentActivity
        filterByActivity: true
        filterNotMinimized: true

        // Roles change in place when a window is maximized or goes fullscreen, so watch the
        // model's signals rather than only its count
        onDataChanged: coverCheck.restart()
        onRowsInserted: coverCheck.restart()
        onRowsRemoved: coverCheck.restart()
        onModelReset: coverCheck.restart()
        onCountChanged: coverCheck.restart()
    }

    property bool isCovered: false

    function computeCovered() {
        for (var i = 0; i < tasks.count; ++i) {
            var idx = tasks.index(i, 0);
            if (!tasks.data(idx, TaskManager.AbstractTasksModel.IsWindow)) continue;
            if (tasks.data(idx, TaskManager.AbstractTasksModel.IsFullScreen)
                || tasks.data(idx, TaskManager.AbstractTasksModel.IsMaximized)) {
                return true;
            }
        }
        return false;
    }

    Timer {
        id: coverCheck
        interval: 150
        onTriggered: root.isCovered = root.computeCovered()
    }

    onIsCoveredChanged: pushPaused()

    WebEngineView {
        id: web
        anchors.fill: parent
        backgroundColor: "#0b0d11"
        property bool fellBackToLocal: false

        settings.localContentCanAccessRemoteUrls: true
        settings.localContentCanAccessFileUrls: true
        settings.javascriptEnabled: true
        settings.playbackRequiresUserGesture: true

        Component.onCompleted: {
            fellBackToLocal = !!root.configuration.Bundled;
            url = (fellBackToLocal ? root.bundledUrl : root.onlineUrl) + "#" + root.getHash();
        }

        onLoadingChanged: function(loadRequest) {
            if (loadRequest.status === WebEngineView.LoadSucceededStatus) {
                root.pushSettings();
                root.pushPaused();
                root.pushPower();
            } else if (loadRequest.status === WebEngineView.LoadFailedStatus && !fellBackToLocal) {
                fellBackToLocal = true;
                url = root.bundledUrl + "#" + root.getHash();
            }
        }

        onContextMenuRequested: function(request) {
            request.accepted = true;
        }
    }

    Connections {
        target: root.configuration
        function onValueChanged(key, value) {
            if (key === "Bundled") {
                web.fellBackToLocal = !!value;
                web.url = (value ? root.bundledUrl : root.onlineUrl) + "#" + root.getHash();
                return;
            }
            root.pushSettings();
            coverCheck.restart();
        }
    }
}
