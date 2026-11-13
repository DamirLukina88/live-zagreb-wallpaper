import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    property alias cfg_City: cityField.text
    property string cfg_Language
    property alias cfg_Sharp: sharpCheck.checked

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

    QQC2.CheckBox {
        id: sharpCheck
        Kirigami.FormData.label: "Kvaliteta / Quality:"
        text: "Oštra slika (Sharp full-res, više CPU/baterije)"
    }
}
