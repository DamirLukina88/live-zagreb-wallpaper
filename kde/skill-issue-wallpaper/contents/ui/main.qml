import QtQuick
import QtWebEngine
import org.kde.plasma.plasmoid
import org.kde.taskmanager as TaskManager

WallpaperItem {
    id: root

    function getConfigJson() {
        return JSON.stringify({
            city: root.configuration.City || "Zagreb",
            lang: root.configuration.Language || "hr",
            sharp: !!root.configuration.Sharp
        });
    }

    function getHash() {
        var c = root.configuration.City || "Zagreb";
        var l = root.configuration.Language || "hr";
        var s = root.configuration.Sharp ? "1" : "0";
        return "city=" + encodeURIComponent(c) + "&lang=" + encodeURIComponent(l) + "&sharp=" + s;
    }

    function pushSettings() {
        if (web && web.loading === false) {
            web.runJavaScript("if (window.wallpaperSettings) window.wallpaperSettings(" + root.getConfigJson() + ");");
        }
    }

    TaskManager.TasksModel {
        id: tasks
        filterByScreen: true
        filterByCurrentVirtualDesktop: true
        filterNotMinimized: true
    }

    readonly property bool isCovered: {
        for (var i = 0; i < tasks.count; ++i) {
            var idx = tasks.index(i, 0);
            var isFull = tasks.data(idx, TaskManager.AbstractTasksModel.IsFullScreen);
            var isMax = tasks.data(idx, TaskManager.AbstractTasksModel.IsMaximized);
            if (isFull || isMax) {
                return true;
            }
        }
        return false;
    }

    WebEngineView {
        id: web
        anchors.fill: parent
        backgroundColor: "#0b0d11"
        property bool fellBackToLocal: false

        settings.localContentCanAccessRemoteUrls: true
        settings.localContentCanAccessFileUrls: true
        settings.javascriptEnabled: true
        settings.playbackRequiresUserGesture: true

        lifecycleState: root.isCovered ? WebEngineView.LifecycleState.Frozen : WebEngineView.LifecycleState.Active

        Component.onCompleted: {
            url = "https://damirlukina88.github.io/live-zagreb-wallpaper/#" + root.getHash();
        }

        onLoadingChanged: function(loadRequest) {
            if (loadRequest.status === WebEngineView.LoadSucceededStatus) {
                root.pushSettings();
            } else if (loadRequest.status === WebEngineView.LoadFailedStatus && !fellBackToLocal) {
                fellBackToLocal = true;
                url = Qt.resolvedUrl("../web/index.html") + "#" + root.getHash();
            }
        }

        onContextMenuRequested: function(request) {
            request.accepted = true;
        }
    }

    Connections {
        target: root.configuration
        function onValueChanged() {
            root.pushSettings();
        }
    }
}
