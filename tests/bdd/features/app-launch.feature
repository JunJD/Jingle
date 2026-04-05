@smoke
Feature: Openwork desktop bootstrap
  Scenario: The main window starts successfully
    Given the Openwork desktop app is launched
    Then the main window should be available
    And the renderer should identify itself as the main window
    And the React root should contain rendered content
