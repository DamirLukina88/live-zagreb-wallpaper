import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    // Plasma hands every wallpaper settings page these two; without them it logs
    // "Cannot assign to non-existent property" each time the dialog opens
    property var configDialog
    property var wallpaperConfiguration

    property alias cfg_City: cityField.text
    property string cfg_Language
    property string cfg_Quality
    property alias cfg_AnimateOnBattery: batteryCheck.checked
    property string cfg_Layout
    property string cfg_SceneDisplay
    property string cfg_PauseRule
    property alias cfg_HeightOffset: offsetSpin.value
    property alias cfg_SideGlass: glassCheck.checked
    property alias cfg_Bundled: bundledCheck.checked
    property alias cfg_FrameRate: fpsSpin.value
    property string cfg_CardCorner
    property alias cfg_ShowCard: showCardCheck.checked

    QQC2.TextField {
        id: cityField
        Kirigami.FormData.label: "Grad / City:"
        placeholderText: "Zagreb"
    }

    QQC2.ComboBox {
        id: langCombo
        Kirigami.FormData.label: "Jezik / Language:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Hrvatski", value: "hr" },
            { text: "English", value: "en" }
        ]
        currentIndex: root.cfg_Language === "en" ? 1 : 0
        onActivated: root.cfg_Language = currentValue
    }

    QQC2.ComboBox {
        id: qualityCombo
        Kirigami.FormData.label: "Kvaliteta / Quality:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Automatski: oštra mirna slika / Automatic: sharp still picture", value: "auto" },
            { text: "Uvijek niska (najmanje memorije) / Always low (least memory)", value: "low" }
        ]
        currentIndex: root.cfg_Quality === "low" ? 1 : 0
        onActivated: root.cfg_Quality = currentValue
    }

    QQC2.CheckBox {
        id: showCardCheck
        Kirigami.FormData.label: "Vremenska kartica / Weather card:"
        text: "Prikaži / Show"
    }

    QQC2.ComboBox {
        id: cornerCombo
        Kirigami.FormData.label: "Kut kartice / Card corner:"
        enabled: showCardCheck.checked
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Gore desno / Top right", value: "tr" },
            { text: "Gore lijevo / Top left", value: "tl" },
            { text: "Dolje desno / Bottom right", value: "br" },
            { text: "Dolje lijevo / Bottom left", value: "bl" }
        ]
        currentIndex: Math.max(0, indexOfValue(root.cfg_CardCorner || "tr"))
        onActivated: root.cfg_CardCorner = currentValue
    }

    QQC2.CheckBox {
        id: batteryCheck
        Kirigami.FormData.label: "Na bateriji / On battery:"
        text: "Animiraj kišu i snijeg i na bateriji / Animate rain and snow on battery too"
    }

    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: "Sličice/s za kišu i snijeg / Frame rate in rain & snow:"
        from: 5
        to: 30
        stepSize: 5
        editable: true
        textFromValue: function (v) { return v + " fps"; }
        valueFromText: function (t) { return parseInt(t, 10) || 15; }
    }

    QQC2.Label {
        Layout.maximumWidth: Kirigami.Units.gridUnit * 24
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
        text: "Bez padalina slika miruje i osvježava se jednom u minuti (sunce, nebo, svjetla) radi grafike i baterije. Ovo vrijedi samo dok pada kiša, snijeg, tuča ili grmi, a na bateriji slika uvijek miruje. / Without precipitation, and always on battery, the picture stays still and is redrawn once a minute (sun, sky, lights) to save GPU and battery. This applies only while rain, snow, hail or a storm is falling."
    }

    Kirigami.Separator {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Više zaslona / Multiple displays"
    }

    QQC2.ComboBox {
        id: layoutCombo
        Kirigami.FormData.label: "Raspored / Layout:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Kopija na svakom zaslonu / Clone on each display", value: "clone" },
            { text: "Jedna scena preko svih / Span over all displays", value: "span" }
        ]
        currentIndex: root.cfg_Layout === "span" ? 1 : 0
        onActivated: root.cfg_Layout = currentValue
    }

    QQC2.ComboBox {
        id: sceneCombo
        Kirigami.FormData.label: "Zaslon sa scenom / Scene display:"
        enabled: root.cfg_Layout === "span"
        textRole: "text"
        valueRole: "value"
        model: {
            var m = [{ text: "Automatski (glavni zaslon) / Automatic (main display)", value: "" }];
            var s = Qt.application.screens;
            for (var i = 0; i < s.length; ++i) {
                m.push({ text: s[i].name + " (" + s[i].width + "×" + s[i].height + ")", value: s[i].name });
            }
            return m;
        }
        currentIndex: Math.max(0, indexOfValue(root.cfg_SceneDisplay))
        onActivated: root.cfg_SceneDisplay = currentValue
    }

    QQC2.CheckBox {
        id: glassCheck
        Kirigami.FormData.label: "Bočni zasloni / Side displays:"
        enabled: root.cfg_Layout === "span"
        text: "Mliječno staklo (isključeno: samo nebo) / Frosted glass (off: sky only)"
    }

    QQC2.SpinBox {
        id: offsetSpin
        Kirigami.FormData.label: "Poravnanje visine / Height alignment:"
        enabled: root.cfg_Layout === "span"
        from: -800
        to: 800
        stepSize: 5
        editable: true
        textFromValue: function (v) { return (v > 0 ? "+" : "") + v + " px"; }
        valueFromText: function (t) { return parseInt(t, 10) || 0; }
    }

    QQC2.Label {
        visible: root.cfg_Layout === "span"
        Layout.maximumWidth: Kirigami.Units.gridUnit * 24
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
        text: "Za bočne zaslone: ako ograda ne pada u istu visinu kao na zaslonu sa scenom, pomakni sliku (+ gore, − dolje). / For the side displays: if the railing doesn't meet the scene display's at the same height on your desk, shift this display's picture (+ up, − down)."
    }

    QQC2.Label {
        visible: root.cfg_Layout === "span"
        Layout.maximumWidth: Kirigami.Units.gridUnit * 24
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
        text: "Postavi istu tapetu i raspored na svakom zaslonu. / Set this wallpaper and layout on every display."
    }

    QQC2.ComboBox {
        id: pauseCombo
        Kirigami.FormData.label: "Pauza / Pause:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Kad je ovaj zaslon prekriven / When this display is covered", value: "screen" },
            { text: "Kad je bilo koji zaslon prekriven / When any display is covered", value: "all" }
        ]
        currentIndex: root.cfg_PauseRule === "all" ? 1 : 0
        onActivated: root.cfg_PauseRule = currentValue
    }

    QQC2.CheckBox {
        id: bundledCheck
        Kirigami.FormData.label: "Izvor / Source:"
        text: "Lokalna kopija (bez mreže) / Bundled copy (offline)"
    }
}
