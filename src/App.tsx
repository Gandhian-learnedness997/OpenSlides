import React, { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import Dashboard from "./components/Dashboard";
import ProjectDetail from "./components/ProjectDetail";
import SettingsModal from "./components/SettingsModal";
import { Project, CurrentView } from '@/types';

function buildPresentDocument(html: string): string {
  return html;
}

export default function App() {
  const isPresentRoute = window.location.pathname === "/present";
  const [presentHtml, setPresentHtml] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<CurrentView>("dashboard");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRestoringProject, setIsRestoringProject] = useState(false);

  useEffect(() => {
    if (!isPresentRoute) return;
    const params = new URLSearchParams(window.location.search);
    const docKey = params.get('docKey') || 'openslides_present_html';
    const html = sessionStorage.getItem(docKey);
    if (!html) return;
    const documentHtml = buildPresentDocument(html);
    setPresentHtml(documentHtml);
  }, [isPresentRoute]);

  const navigateToUrl = async () => {
    if (isPresentRoute) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");

    if (!projectId) {
      setSelectedProject(null);
      setCurrentView("dashboard");
      setIsRestoringProject(false);
      return;
    }

    setIsRestoringProject(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
      const projects: Project[] = await res.json();
      const project = projects.find((p) => p.id === projectId) || null;

      if (project) {
        setSelectedProject(project);
        setCurrentView("project");
      } else {
        setSelectedProject(null);
        setCurrentView("dashboard");
      }
    } catch (error) {
      console.error('Failed to restore project from URL:', error);
      setSelectedProject(null);
      setCurrentView("dashboard");
    } finally {
      setIsRestoringProject(false);
    }
  };

  // Restore project from URL on mount
  useEffect(() => {
    navigateToUrl();
  }, [isPresentRoute]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => navigateToUrl();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isPresentRoute]);

  useEffect(() => {
    if (!isPresentRoute || !presentHtml) return;
    document.open();
    document.write(presentHtml);
    document.close();
  }, [isPresentRoute, presentHtml]);

  if (isPresentRoute) {
    return null;
  }

  return (
    <div className="h-screen bg-background text-text-primary font-sans overflow-hidden flex flex-col">
      <Navbar
        goHome={() => {
          setCurrentView("dashboard");
          setSelectedProject(null);
          window.history.pushState({}, "", "/");
        }}
        currentView={currentView}
        projectName={selectedProject?.name}
        projectId={selectedProject?.id}
        onSettingsClick={() => setIsSettingsModalOpen(true)}
        onRename={async (newName: string) => {
          if (!selectedProject) return;
          try {
            const res = await fetch(`/api/projects/${selectedProject.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName }),
            });
            if (!res.ok) {
              throw new Error(`Failed to rename project: ${res.status}`);
            }
            const updatedProject: Project = await res.json();
            setSelectedProject(updatedProject);
          } catch (error) {
            console.error('Failed to rename project:', error);
          }
        }}
      />
      <main className="flex-1 overflow-hidden">
        {!isRestoringProject && currentView === "dashboard" && (
          <div className="max-w-5xl mx-auto p-6 h-full overflow-y-auto custom-scrollbar">
            <Dashboard
              onSelectProject={(project: Project) => {
                setSelectedProject(project);
                setCurrentView("project");
                window.history.pushState({}, "", `?project=${project.id}`);
              }}
            />
          </div>
        )}
        {currentView === "project" && selectedProject && (
          <ProjectDetail
            project={selectedProject}
            onBack={() => {
              setSelectedProject(null);
              setCurrentView("dashboard");
              window.history.pushState({}, "", "/");
            }}
          />
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
